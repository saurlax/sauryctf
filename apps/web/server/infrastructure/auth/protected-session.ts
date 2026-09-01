import type { H3Event } from 'h3'
import { authSessionDataSchema } from '../../../shared/contracts/auth-session'
import {
  InvalidIdentitySessionError,
  type IdentitySessionValidator,
} from '../../domains/identity/session'
import { createApiError } from '../http/errors'

export interface IdentitySessionCookie {
  read(): Promise<unknown>
  clear(): Promise<unknown>
}

export async function resolveProtectedIdentity(
  cookie: IdentitySessionCookie,
  sessions: IdentitySessionValidator,
) {
  return (await resolveProtectedIdentitySession(cookie, sessions)).subject
}

export async function resolveProtectedIdentitySession(
  cookie: IdentitySessionCookie,
  sessions: IdentitySessionValidator,
) {
  const parsed = authSessionDataSchema.safeParse(await cookie.read())
  if (!parsed.success) {
    await cookie.clear()
    throw createApiError(401, 'identity.session_invalid', '当前登录状态已失效')
  }

  try {
    return {
      session: parsed.data,
      subject: await sessions.validate(parsed.data),
    }
  }
  catch (error) {
    if (!(error instanceof InvalidIdentitySessionError)) throw error
    await cookie.clear()
    throw createApiError(401, 'identity.session_invalid', '当前登录状态已失效')
  }
}

export async function requireProtectedIdentity(event: H3Event, sessions: IdentitySessionValidator) {
  return resolveProtectedIdentity({
    read: () => getUserSession(event),
    clear: () => clearUserSession(event),
  }, sessions)
}

export async function requireProtectedIdentitySession(event: H3Event, sessions: IdentitySessionValidator) {
  return resolveProtectedIdentitySession({
    read: () => getUserSession(event),
    clear: () => clearUserSession(event),
  }, sessions)
}
