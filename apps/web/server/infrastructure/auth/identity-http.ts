import type { H3Event } from 'h3'
import { getQuery, setResponseStatus } from 'h3'
import {
  adminUserListRequestSchema,
  adminUserListResponseSchema,
  changeUserStatusRequestSchema,
  changeGlobalRoleRequestSchema,
  changeEmailRequestSchema,
  changePasswordRequestSchema,
  emailVerificationConfirmRequestSchema,
  emailChangedSchema,
  emailVerifiedSchema,
  globalRoleChangedSchema,
  identityLogoutResponseSchema,
  identitySessionResponseSchema,
  loginIdentityRequestSchema,
  passwordChangedSchema,
  passwordResetConfirmRequestSchema,
  passwordResetRequestSchema,
  publicPasswordResetResponse,
  registerIdentityRequestSchema,
  userStatusChangedSchema,
} from '../../../shared/contracts/identity'
import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import { requestIdSchema } from '../../../shared/contracts/http'
import {
  IdentityCapabilityError,
  type IdentityCapability,
  identityCapability,
  requireIdentityCapability,
} from '../../domains/identity/capabilities'
import {
  IdentityServiceError,
  type IdentityService,
} from '../../domains/identity/service'
import {
  HumanVerificationError,
  requireHumanVerification,
  type HumanVerificationProvider,
} from '../../domains/identity/human-verification'
import type { IdentitySessionValidator } from '../../domains/identity/session'
import { readValidatedJsonBody } from '../http/body'
import { createApiError } from '../http/errors'
import { enforceUserRateLimit, getClientIp } from '../security/request-security'
import type { RateLimitStore } from '../security/rate-limit'
import { resolveProtectedIdentitySession } from './protected-session'

type IdentityCommands = Pick<IdentityService,
  | 'changeGlobalRole'
  | 'changeUserStatus'
  | 'changeEmail'
  | 'changePassword'
  | 'listManagedIdentities'
  | 'login'
  | 'register'
  | 'requestPasswordReset'
  | 'resetPassword'
  | 'requestEmailVerification'
  | 'verifyEmail'>

export interface BrowserSessionAdapter {
  read(event: H3Event): Promise<unknown>
  replace(event: H3Event, session: AuthSessionData): Promise<unknown>
  clear(event: H3Event): Promise<unknown>
}

export interface IdentityHttpDependencies {
  identity: IdentityCommands
  sessions: IdentitySessionValidator
  humanVerification: HumanVerificationProvider
  rateLimits: RateLimitStore
  browserSession: BrowserSessionAdapter
}

const nuxtBrowserSession: BrowserSessionAdapter = {
  read: async (event) => {
    const { id: _sessionId, ...payload } = await getUserSession(event)
    return payload
  },
  replace: (event, session) => replaceUserSession(event, session),
  clear: event => clearUserSession(event),
}

export function identityHttpDependencies(event: H3Event): IdentityHttpDependencies {
  const services = event.context.services
  if (!services) {
    throw createApiError(503, 'platform.not_ready', '控制面数据库服务尚未就绪')
  }
  return {
    identity: services.identity,
    sessions: services.identitySessions,
    humanVerification: services.humanVerification,
    rateLimits: services.rateLimits,
    browserSession: nuxtBrowserSession,
  }
}

export async function requireProtectedCapability(
  event: H3Event,
  capability: IdentityCapability,
  dependencies: IdentityHttpDependencies,
) {
  try {
    const context = await resolveProtectedIdentitySession({
      read: () => dependencies.browserSession.read(event),
      clear: () => dependencies.browserSession.clear(event),
    }, dependencies.sessions)
    requireIdentityCapability(context.subject, capability)
    return context
  }
  catch (error) {
    if (error instanceof IdentityCapabilityError) {
      throw createApiError(403, error.code, error.message)
    }
    throw error
  }
}

export async function handleChangePassword(event: H3Event, dependencies: IdentityHttpDependencies) {
  const context = await requireProtectedCapability(event, identityCapability.accountWrite, dependencies)
  await enforceUserRateLimit(
    event,
    dependencies.rateLimits,
    context.subject.userId,
    'identity.password.change',
    5,
    15 * 60_000,
  )
  const input = await readValidatedJsonBody(event, changePasswordRequestSchema)
  const result = await runIdentityOperation(() => dependencies.identity.changePassword(
    context.subject.userId,
    input.current_password,
    input.new_password,
  ))
  await dependencies.browserSession.replace(event, {
    user_id: result.userId,
    session_version: result.sessionVersion,
    logged_in_at: context.session.logged_in_at,
  })
  return passwordChangedSchema.parse({ changed: true })
}

export async function handleRegister(event: H3Event, dependencies: IdentityHttpDependencies) {
  const input = await readValidatedJsonBody(event, registerIdentityRequestSchema)
  await runHumanVerification(() => requireHumanVerification(dependencies.humanVerification, {
    token: input.turnstile_token,
    remoteIp: getClientIp(event),
    action: 'register',
  }))
  const registered = await runIdentityOperation(() => dependencies.identity.register({
    username: input.username,
    email: input.email,
    password: input.password,
  }))
  const session = {
    user_id: registered.userId,
    session_version: registered.sessionVersion,
    logged_in_at: new Date().toISOString(),
  }
  await dependencies.browserSession.replace(event, session)
  const subject = await dependencies.sessions.validate(session)
  setResponseStatus(event, 201)
  return identitySessionResponseSchema.parse({ user: identityUser(subject) })
}

export async function handleLogin(event: H3Event, dependencies: IdentityHttpDependencies) {
  const input = await readValidatedJsonBody(event, loginIdentityRequestSchema)
  await runHumanVerification(() => requireHumanVerification(dependencies.humanVerification, {
    token: input.turnstile_token,
    remoteIp: getClientIp(event),
    action: 'login',
  }))
  const login = await runIdentityOperation(() => dependencies.identity.login({
    identifier: input.identifier,
    password: input.password,
  }))
  const session = {
    user_id: login.userId,
    session_version: login.sessionVersion,
    logged_in_at: new Date().toISOString(),
  }
  await dependencies.browserSession.replace(event, session)
  const subject = await dependencies.sessions.validate(session)
  return identitySessionResponseSchema.parse({ user: identityUser(subject) })
}

export async function handleCurrentIdentity(event: H3Event, dependencies: IdentityHttpDependencies) {
  const context = await requireProtectedCapability(event, identityCapability.accountRead, dependencies)
  return identitySessionResponseSchema.parse({ user: identityUser(context.subject) })
}

export async function handleLogout(event: H3Event, dependencies: IdentityHttpDependencies) {
  await dependencies.browserSession.clear(event)
  return identityLogoutResponseSchema.parse({ logged_out: true })
}

export async function handleListManagedIdentities(event: H3Event, dependencies: IdentityHttpDependencies) {
  const context = await requireProtectedCapability(event, identityCapability.userManage, dependencies)
  const query = adminUserListRequestSchema.parse(getQuery(event))
  const result = await runIdentityOperation(() => dependencies.identity.listManagedIdentities(
    context.subject,
    query.cursor,
    query.limit,
  ))
  return adminUserListResponseSchema.parse({
    items: result.items.map(item => ({
      id: item.userId,
      username: item.username,
      email: item.email,
      email_verified: item.emailVerified,
      status: item.status,
      role: item.role,
      session_version: item.sessionVersion,
      must_change_password: item.mustChangePassword,
      created_at: item.createdAt.toISOString(),
    })),
    page: { next_cursor: result.nextCursor, has_more: result.hasMore },
  })
}

export async function handleChangeUserStatus(
  event: H3Event,
  dependencies: IdentityHttpDependencies,
  targetUserId: string,
) {
  const context = await requireProtectedCapability(event, identityCapability.userManage, dependencies)
  const input = await readValidatedJsonBody(event, changeUserStatusRequestSchema)
  const result = await runIdentityOperation(() => dependencies.identity.changeUserStatus(
    context.subject,
    {
      targetUserId,
      status: input.status,
      reason: input.reason,
      requestId: requestIdSchema.parse(event.context.requestId),
    },
  ))
  return userStatusChangedSchema.parse({
    user_id: result.userId,
    previous_status: result.previousStatus,
    status: result.status,
    session_version: result.sessionVersion,
    changed: result.changed,
  })
}

export async function handleChangeGlobalRole(
  event: H3Event,
  dependencies: IdentityHttpDependencies,
  targetUserId: string,
) {
  const context = await requireProtectedCapability(event, identityCapability.roleManage, dependencies)
  const input = await readValidatedJsonBody(event, changeGlobalRoleRequestSchema)
  const result = await runIdentityOperation(() => dependencies.identity.changeGlobalRole(
    context.subject,
    {
      targetUserId,
      role: input.role,
      reason: input.reason,
      requestId: requestIdSchema.parse(event.context.requestId),
    },
  ))
  return globalRoleChangedSchema.parse({
    user_id: result.userId,
    previous_role: result.previousRole,
    role: result.role,
    session_version: result.sessionVersion,
    changed: result.changed,
  })
}

export async function handleChangeEmail(event: H3Event, dependencies: IdentityHttpDependencies) {
  const context = await requireProtectedCapability(event, identityCapability.accountWrite, dependencies)
  await enforceUserRateLimit(
    event,
    dependencies.rateLimits,
    context.subject.userId,
    'identity.email.change',
    3,
    15 * 60_000,
  )
  const input = await readValidatedJsonBody(event, changeEmailRequestSchema)
  const result = await runIdentityOperation(() => dependencies.identity.changeEmail(
    context.subject.userId,
    input.email,
  ))
  await dependencies.browserSession.replace(event, {
    user_id: result.userId,
    session_version: result.sessionVersion,
    logged_in_at: context.session.logged_in_at,
  })
  return emailChangedSchema.parse({ changed: true })
}

export async function handlePasswordResetRequest(event: H3Event, dependencies: IdentityHttpDependencies) {
  const input = await readValidatedJsonBody(event, passwordResetRequestSchema)
  await runHumanVerification(() => requireHumanVerification(dependencies.humanVerification, {
    token: input.turnstile_token,
    remoteIp: getClientIp(event),
    action: 'password_reset',
  }))
  await runIdentityOperation(() => dependencies.identity.requestPasswordReset(input.email))
  setResponseStatus(event, 202)
  return publicPasswordResetResponse()
}

async function runHumanVerification(operation: () => Promise<void>): Promise<void> {
  try {
    await operation()
  }
  catch (error) {
    if (!(error instanceof HumanVerificationError)) throw error
    throw createApiError(403, error.code, error.message)
  }
}

export async function handlePasswordResetConfirm(event: H3Event, dependencies: IdentityHttpDependencies) {
  const input = await readValidatedJsonBody(event, passwordResetConfirmRequestSchema)
  await runIdentityOperation(() => dependencies.identity.resetPassword(input.token, input.new_password))
  await dependencies.browserSession.clear(event)
  return passwordChangedSchema.parse({ changed: true })
}

export async function handleEmailVerificationRequest(event: H3Event, dependencies: IdentityHttpDependencies) {
  const context = await requireProtectedCapability(event, identityCapability.verificationResend, dependencies)
  await enforceUserRateLimit(
    event,
    dependencies.rateLimits,
    context.subject.userId,
    'identity.email.verify.request',
    3,
    15 * 60_000,
  )
  await runIdentityOperation(() => dependencies.identity.requestEmailVerification(context.subject.userId))
  setResponseStatus(event, 202)
  return publicPasswordResetResponse()
}

export async function handleEmailVerificationConfirm(event: H3Event, dependencies: IdentityHttpDependencies) {
  const input = await readValidatedJsonBody(event, emailVerificationConfirmRequestSchema)
  await runIdentityOperation(() => dependencies.identity.verifyEmail(input.token))
  return emailVerifiedSchema.parse({ verified: true })
}

async function runIdentityOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (error instanceof IdentityCapabilityError) {
      throw createApiError(403, error.code, error.message)
    }
    if (!(error instanceof IdentityServiceError)) throw error
    const statusCode = error.code === 'identity.registration_disabled'
      ? 403
      : error.code === 'identity.conflict'
      || error.code === 'identity.password_unchanged'
      || error.code === 'identity.self_management_forbidden'
      ? 409
      : error.code === 'identity.not_found'
        ? 404
      : error.code === 'identity.invalid_credentials'
        ? 401
        : 400
    throw createApiError(statusCode, error.code, error.message)
  }
}

function identityUser(subject: Awaited<ReturnType<IdentitySessionValidator['validate']>>) {
  return {
    id: subject.userId,
    username: subject.username,
    email: subject.email,
    email_verified: subject.emailVerified,
    status: subject.status,
    role: subject.role,
    session_version: subject.sessionVersion,
    must_change_password: subject.mustChangePassword,
  }
}
