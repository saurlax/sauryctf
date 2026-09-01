import {
  createApp,
  eventHandler,
  setResponseStatus,
  toWebHandler,
  type H3Event,
} from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import { identityCapability } from '../../domains/identity/capabilities'
import type { SessionSubject } from '../../domains/identity/repository'
import { IdentityServiceError } from '../../domains/identity/service'
import { InvalidIdentitySessionError } from '../../domains/identity/session'
import { DisabledHumanVerificationProvider } from '../../domains/identity/human-verification'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from '../security/rate-limit'
import {
  handleChangeEmail,
  handleChangeGlobalRole,
  handleChangePassword,
  handleChangeUserStatus,
  handleEmailVerificationConfirm,
  handleEmailVerificationRequest,
  handlePasswordResetConfirm,
  handlePasswordResetRequest,
  requireProtectedCapability,
  type IdentityHttpDependencies,
} from './identity-http'

const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c'
const userId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2d'
const originalSession: AuthSessionData = {
  user_id: userId,
  session_version: 1,
  logged_in_at: '2026-09-01T07:08:09.123Z',
}

const verifiedSubject: SessionSubject = {
  userId,
  username: 'Player',
  email: 'player@example.test',
  emailVerified: true,
  status: 'active',
  role: 'user',
  sessionVersion: 1,
  mustChangePassword: false,
}

type IdentityHandler = (event: H3Event, dependencies: IdentityHttpDependencies) => Promise<unknown>

function createDependencies(overrides: Partial<IdentityHttpDependencies['identity']> = {}) {
  let session: unknown = originalSession
  let authoritativeVersion = 1
  const replace = vi.fn(async (_event: H3Event, next: AuthSessionData) => {
    session = next
  })
  const clear = vi.fn(async () => {
    session = null
  })
  const dependencies: IdentityHttpDependencies = {
    identity: {
      changeEmail: vi.fn(async () => {
        authoritativeVersion += 1
        return { userId, sessionVersion: authoritativeVersion }
      }),
      changeGlobalRole: vi.fn(async (_actor, input) => ({
        userId: input.targetUserId,
        previousRole: 'user' as const,
        role: input.role,
        sessionVersion: 2,
        changed: true,
      })),
      changeUserStatus: vi.fn(async (_actor, input) => ({
        userId: input.targetUserId,
        previousStatus: 'active' as const,
        status: input.status,
        sessionVersion: 2,
        changed: true,
      })),
      changePassword: vi.fn(async () => {
        authoritativeVersion += 1
        return { userId, sessionVersion: authoritativeVersion }
      }),
      listManagedIdentities: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
      login: vi.fn(async () => ({
        userId,
        sessionVersion: authoritativeVersion,
        passwordHashUpgraded: false,
      })),
      register: vi.fn(async () => ({ userId, sessionVersion: authoritativeVersion })),
      requestPasswordReset: vi.fn(async () => ({ accepted: true as const, delivery: null })),
      resetPassword: vi.fn(async () => {
        authoritativeVersion += 1
        return { userId, sessionVersion: authoritativeVersion }
      }),
      requestEmailVerification: vi.fn(async () => ({
        token: 'v'.repeat(43),
        purpose: 'verify_email' as const,
        expiresAt: new Date('2026-09-01T08:30:00.000Z'),
      })),
      verifyEmail: vi.fn(async () => ({ userId, sessionVersion: authoritativeVersion })),
      ...overrides,
    },
    sessions: {
      validate: vi.fn(async (candidate) => {
        if (candidate.session_version !== authoritativeVersion) throw new InvalidIdentitySessionError()
        return { ...verifiedSubject, sessionVersion: authoritativeVersion }
      }),
    },
    humanVerification: new DisabledHumanVerificationProvider(),
    rateLimits: new MemoryRateLimitStore(),
    browserSession: {
      read: vi.fn(async () => session),
      replace,
      clear,
    },
  }
  return { dependencies, replace, clear, setSession: (value: unknown) => { session = value } }
}

async function invoke(
  handler: IdentityHandler,
  dependencies: IdentityHttpDependencies,
  body: unknown = {},
): Promise<Response> {
  const app = createApp()
  app.use(eventHandler(async (event) => {
    event.context.requestId = requestId
    try {
      return await handler(event, dependencies)
    }
    catch (error) {
      const response = normalizeApiError(error, requestId)
      setResponseStatus(event, response.statusCode)
      return response.body
    }
  }))
  return toWebHandler(app)(new Request('https://ctf.example.test/api/auth/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

describe('identity HTTP adapters', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('refreshes only the current sealed session after changing the password', async () => {
    const { dependencies, replace, clear, setSession } = createDependencies()
    const response = await invoke(handleChangePassword, dependencies, {
      current_password: 'old password',
      new_password: 'new password',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ changed: true })
    expect(replace).toHaveBeenCalledWith(expect.anything(), {
      user_id: userId,
      session_version: 2,
      logged_in_at: originalSession.logged_in_at,
    })

    setSession(originalSession)
    const stale = await invoke(async (event, deps) => {
      await requireProtectedCapability(event, identityCapability.accountRead, deps)
      return { ok: true }
    }, dependencies)
    expect(stale.status).toBe(401)
    expect(clear).toHaveBeenCalled()
  })

  it('lets a restricted bootstrap account set its email and refreshes only the current session', async () => {
    const { dependencies, replace } = createDependencies()
    dependencies.sessions.validate = vi.fn(async (candidate: AuthSessionData) => ({
      ...verifiedSubject,
      emailVerified: false,
      mustChangePassword: true,
      role: 'admin' as const,
      sessionVersion: candidate.session_version,
    }))
    const response = await invoke(handleChangeEmail, dependencies, {
      email: 'operator@example.test',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ changed: true })
    expect(dependencies.identity.changeEmail).toHaveBeenCalledWith(userId, 'operator@example.test')
    expect(replace).toHaveBeenCalledWith(expect.anything(), {
      user_id: userId,
      session_version: 2,
      logged_in_at: originalSession.logged_in_at,
    })
  })

  it('returns an identical public reset response for existing and missing email addresses', async () => {
    const rawToken = 'r'.repeat(43)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const existing = createDependencies({
      requestPasswordReset: vi.fn(async () => ({
        accepted: true as const,
        delivery: {
          userId,
          emailNormalized: 'player@example.test',
          token: rawToken,
          purpose: 'reset_password' as const,
          expiresAt: new Date('2026-09-01T08:15:00.000Z'),
        },
      })),
    })
    const missing = createDependencies()

    const existingResponse = await invoke(handlePasswordResetRequest, existing.dependencies, {
      email: 'player@example.test',
    })
    const missingResponse = await invoke(handlePasswordResetRequest, missing.dependencies, {
      email: 'missing@example.test',
    })
    const existingText = await existingResponse.text()
    const missingText = await missingResponse.text()

    expect(existingResponse.status).toBe(202)
    expect(missingResponse.status).toBe(202)
    expect(existingText).toBe(missingText)
    expect(JSON.parse(existingText)).toEqual({ accepted: true })
    expect(existingText).not.toContain(rawToken)
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(rawToken)
  })

  it('requires and verifies Turnstile only when the provider is enabled', async () => {
    const { dependencies } = createDependencies()
    const verify = vi.fn(async ({ token }) => token === 'valid-turnstile-token')
    dependencies.humanVerification = { required: true, verify }

    const missing = await invoke(handlePasswordResetRequest, dependencies, {
      email: 'player@example.test',
    })
    expect(missing.status).toBe(403)
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: 'security.human_verification_required' },
    })

    const invalid = await invoke(handlePasswordResetRequest, dependencies, {
      email: 'player@example.test',
      turnstile_token: 'invalid-turnstile-token',
    })
    expect(invalid.status).toBe(403)
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: 'security.human_verification_failed' },
    })

    const valid = await invoke(handlePasswordResetRequest, dependencies, {
      email: 'player@example.test',
      turnstile_token: 'valid-turnstile-token',
    })
    expect(valid.status).toBe(202)
    expect(verify).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'password_reset',
      token: 'valid-turnstile-token',
    }))
  })

  it('clears any browser cookie after a successful password reset', async () => {
    const { dependencies, clear } = createDependencies()
    const response = await invoke(handlePasswordResetConfirm, dependencies, {
      token: 'r'.repeat(43),
      new_password: 'replacement password',
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ changed: true })
    expect(clear).toHaveBeenCalledOnce()
  })

  it('delivers verification material internally but never returns the token', async () => {
    const { dependencies } = createDependencies()
    const response = await invoke(handleEmailVerificationRequest, dependencies)
    const body = await response.text()
    expect(response.status).toBe(202)
    expect(JSON.parse(body)).toEqual({ accepted: true })
    expect(body).not.toContain('v'.repeat(43))
  })

  it('maps expired or consumed verification tokens to one stable API error', async () => {
    const { dependencies } = createDependencies({
      verifyEmail: vi.fn(async () => { throw new IdentityServiceError('identity.token_invalid') }),
    })
    const response = await invoke(handleEmailVerificationConfirm, dependencies, {
      token: 'x'.repeat(43),
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'identity.token_invalid',
        message: '凭证无效或已过期',
        request_id: requestId,
        fields: {},
      },
    })
  })

  it('rejects a participation capability for an unverified principal', async () => {
    const { dependencies } = createDependencies()
    dependencies.sessions.validate = vi.fn(async () => ({
      ...verifiedSubject,
      emailVerified: false,
    }))
    const response = await invoke(async (event, deps) => {
      await requireProtectedCapability(event, identityCapability.teamWrite, deps)
      return { ok: true }
    }, dependencies)
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'identity.email_verification_required' },
    })
  })

  it.each(['user', 'organizer'] as const)('rejects %s role changes at the HTTP and domain boundary', async (role) => {
    const { dependencies } = createDependencies()
    dependencies.sessions.validate = vi.fn(async () => ({ ...verifiedSubject, role }))
    const response = await invoke(
      (event, deps) => handleChangeGlobalRole(event, deps, '018f47a2-4ef8-7e2c-9c24-6d68b7451f30'),
      dependencies,
      { role: 'organizer', reason: 'Adjust global responsibilities' },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'identity.capability_forbidden' },
    })
    expect(dependencies.identity.changeGlobalRole).not.toHaveBeenCalled()
  })

  it('allows an admin to change a global role through the management API', async () => {
    const { dependencies } = createDependencies()
    dependencies.sessions.validate = vi.fn(async () => ({ ...verifiedSubject, role: 'admin' as const }))
    const targetUserId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f30'
    const response = await invoke(
      (event, deps) => handleChangeGlobalRole(event, deps, targetUserId),
      dependencies,
      { role: 'organizer', reason: 'Assign contest operations' },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      user_id: targetUserId,
      previous_role: 'user',
      role: 'organizer',
      session_version: 2,
      changed: true,
    })
    expect(dependencies.identity.changeGlobalRole).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin' }),
      {
        targetUserId,
        role: 'organizer',
        reason: 'Assign contest operations',
        requestId,
      },
    )
  })

  it.each([
    {
      name: 'role',
      handler: (event: H3Event, deps: IdentityHttpDependencies) => handleChangeGlobalRole(
        event,
        deps,
        '018f47a2-4ef8-7e2c-9c24-6d68b7451f30',
      ),
      body: { role: 'organizer' },
      method: 'changeGlobalRole' as const,
    },
    {
      name: 'status',
      handler: (event: H3Event, deps: IdentityHttpDependencies) => handleChangeUserStatus(
        event,
        deps,
        '018f47a2-4ef8-7e2c-9c24-6d68b7451f30',
      ),
      body: { status: 'banned' },
      method: 'changeUserStatus' as const,
    },
  ])('rejects an admin $name change without a management reason', async ({ handler, body, method }) => {
    const { dependencies } = createDependencies()
    dependencies.sessions.validate = vi.fn(async () => ({ ...verifiedSubject, role: 'admin' as const }))

    const response = await invoke(handler, dependencies, body)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'validation.failed', request_id: requestId },
    })
    expect(dependencies.identity[method]).not.toHaveBeenCalled()
  })

  it('passes the actor, reason, and request id to a status change', async () => {
    const { dependencies } = createDependencies()
    dependencies.sessions.validate = vi.fn(async () => ({ ...verifiedSubject, role: 'admin' as const }))
    const targetUserId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f30'

    const response = await invoke(
      (event, deps) => handleChangeUserStatus(event, deps, targetUserId),
      dependencies,
      { status: 'banned', reason: 'Confirmed account abuse' },
    )

    expect(response.status).toBe(200)
    expect(dependencies.identity.changeUserStatus).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin' }),
      {
        targetUserId,
        status: 'banned',
        reason: 'Confirmed account abuse',
        requestId,
      },
    )
  })
})
