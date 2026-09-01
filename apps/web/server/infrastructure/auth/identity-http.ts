import type { H3Event } from 'h3'
import { setResponseStatus } from 'h3'
import {
  changeGlobalRoleRequestSchema,
  changeEmailRequestSchema,
  changePasswordRequestSchema,
  emailVerificationConfirmRequestSchema,
  emailChangedSchema,
  emailVerifiedSchema,
  globalRoleChangedSchema,
  passwordChangedSchema,
  passwordResetConfirmRequestSchema,
  passwordResetRequestSchema,
  publicPasswordResetResponse,
} from '../../../shared/contracts/identity'
import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import {
  IdentityCapabilityError,
  type IdentityCapability,
  identityCapability,
  requireIdentityCapability,
} from '../../domains/identity/capabilities'
import type { IdentityTokenDelivery } from '../../domains/identity/delivery'
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
import { structuredLog } from '../telemetry/logging'
import { readValidatedJsonBody } from '../http/body'
import { createApiError } from '../http/errors'
import { enforceUserRateLimit, getClientIp } from '../security/request-security'
import type { RateLimitStore } from '../security/rate-limit'
import { resolveProtectedIdentitySession } from './protected-session'

type IdentityCommands = Pick<IdentityService,
  | 'changeGlobalRole'
  | 'changeEmail'
  | 'changePassword'
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
  delivery: IdentityTokenDelivery
  humanVerification: HumanVerificationProvider
  rateLimits: RateLimitStore
  browserSession: BrowserSessionAdapter
}

const nuxtBrowserSession: BrowserSessionAdapter = {
  read: event => getUserSession(event),
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
    delivery: services.identityTokenDelivery,
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

export async function handleChangeGlobalRole(
  event: H3Event,
  dependencies: IdentityHttpDependencies,
  targetUserId: string,
) {
  const context = await requireProtectedCapability(event, identityCapability.roleManage, dependencies)
  const input = await readValidatedJsonBody(event, changeGlobalRoleRequestSchema)
  const result = await runIdentityOperation(() => dependencies.identity.changeGlobalRole(
    context.subject,
    targetUserId,
    input.role,
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
  const result = await runIdentityOperation(() => dependencies.identity.requestPasswordReset(input.email))
  if (result.delivery) {
    await deliverWithoutDisclosure(dependencies.delivery, {
      userId: result.delivery.userId,
      recipient: result.delivery.emailNormalized,
      token: result.delivery.token,
      purpose: result.delivery.purpose,
      expiresAt: result.delivery.expiresAt,
    })
  }
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
  const issued = await runIdentityOperation(() => dependencies.identity.requestEmailVerification(context.subject.userId))
  await deliverWithoutDisclosure(dependencies.delivery, {
    ...issued,
    userId: context.subject.userId,
    recipient: context.subject.email,
  })
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
    const statusCode = error.code === 'identity.conflict'
      || error.code === 'identity.password_unchanged'
      ? 409
      : error.code === 'identity.not_found'
        ? 404
      : error.code === 'identity.invalid_credentials'
        ? 401
        : 400
    throw createApiError(statusCode, error.code, error.message)
  }
}

async function deliverWithoutDisclosure(
  delivery: IdentityTokenDelivery,
  message: Parameters<IdentityTokenDelivery['deliver']>[0],
): Promise<void> {
  try {
    await delivery.deliver(message)
  }
  catch {
    console.error(structuredLog('error', 'identity.token_delivery_deferred', {
      user_id: message.userId,
      purpose: message.purpose,
    }))
  }
}
