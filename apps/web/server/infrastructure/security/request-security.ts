import { timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import {
  getCookie,
  getRequestHeader,
  getRequestIP,
  getRequestURL,
  setResponseHeader,
} from 'h3'
import {
  csrfCookieName,
  csrfHeaderName,
  csrfTokenSchema,
} from '../../../shared/contracts/request-security'
import { createApiError } from '../http/errors'
import { rateLimitBucket, type RateLimitStore } from './rate-limit'

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const cookieFreeWritePaths = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/password/reset/request',
  '/api/auth/password/reset/confirm',
  '/api/auth/email/verification/confirm',
])

const actionPolicies = new Map<string, { action: string, limit: number, windowMs: number }>([
  ['/api/auth/login', { action: 'identity.login', limit: 10, windowMs: 15 * 60_000 }],
  ['/api/auth/register', { action: 'identity.register', limit: 5, windowMs: 60 * 60_000 }],
  ['/api/auth/password/change', { action: 'identity.password.change', limit: 10, windowMs: 15 * 60_000 }],
  ['/api/auth/password/reset/request', { action: 'identity.password.reset.request', limit: 5, windowMs: 15 * 60_000 }],
  ['/api/auth/password/reset/confirm', { action: 'identity.password.reset.confirm', limit: 10, windowMs: 15 * 60_000 }],
  ['/api/auth/email/verification/request', { action: 'identity.email.verify.request', limit: 5, windowMs: 15 * 60_000 }],
  ['/api/auth/email/verification/confirm', { action: 'identity.email.verify.confirm', limit: 20, windowMs: 15 * 60_000 }],
])

export function isUnsafeApiRequest(event: H3Event): boolean {
  return unsafeMethods.has(event.method) && getRequestURL(event).pathname.startsWith('/api/')
}

export function assertSameOrigin(event: H3Event, configuredOrigin?: string): void {
  if (!isUnsafeApiRequest(event)) return
  const origin = getRequestHeader(event, 'origin')
  const expectedOrigin = configuredOrigin || getRequestURL(event).origin
  try {
    if (!origin || new URL(origin).origin !== new URL(expectedOrigin).origin) throw new Error('origin mismatch')
  }
  catch {
    throw createApiError(403, 'security.origin_invalid', '请求来源不受信任')
  }
}

export function assertCsrfProof(event: H3Event): void {
  if (!isUnsafeApiRequest(event)) return
  const path = getRequestURL(event).pathname
  if (cookieFreeWritePaths.has(path)) return
  const cookieToken = getCookie(event, csrfCookieName)
  const headerToken = getRequestHeader(event, csrfHeaderName)
  const cookie = csrfTokenSchema.safeParse(cookieToken)
  const header = csrfTokenSchema.safeParse(headerToken)
  if (!cookie.success || !header.success) {
    throw createApiError(403, 'security.csrf_invalid', 'CSRF 凭证无效或缺失')
  }
  const cookieBytes = Buffer.from(cookie.data, 'utf8')
  const headerBytes = Buffer.from(header.data, 'utf8')
  if (cookieBytes.length !== headerBytes.length || !timingSafeEqual(cookieBytes, headerBytes)) {
    throw createApiError(403, 'security.csrf_invalid', 'CSRF 凭证无效或缺失')
  }
}

export async function enforceNetworkRateLimits(event: H3Event, store: RateLimitStore): Promise<void> {
  if (!isUnsafeApiRequest(event)) return
  const path = getRequestURL(event).pathname
  const policy = actionPolicies.get(path)
  if (!policy) return
  const ip = getClientIp(event)
  await enforceRateLimit(event, store, rateLimitBucket('network', ip, 'identity.security'), 120, 60_000)
  await enforceRateLimit(event, store, rateLimitBucket('network', ip, policy.action), policy.limit, policy.windowMs)
}

export function getClientIp(event: H3Event): string {
  const trustProxy = process.env.TRUST_PROXY === 'true'
  return getRequestIP(event, { xForwardedFor: trustProxy }) || 'unknown'
}

export async function enforceUserRateLimit(
  event: H3Event,
  store: RateLimitStore,
  userId: string,
  action: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  await enforceRateLimit(event, store, rateLimitBucket('user', userId, action), limit, windowMs)
}

export async function enforceFlagSubmissionNetworkRateLimits(
  event: H3Event,
  store: RateLimitStore,
  challengeId: string,
): Promise<void> {
  const ip = getClientIp(event)
  await enforceRateLimit(
    event,
    store,
    rateLimitBucket('network', ip, 'submission.flag'),
    120,
    60_000,
  )
  await enforceRateLimit(
    event,
    store,
    rateLimitBucket('network', `${ip}\0${challengeId}`, 'submission.flag.challenge'),
    30,
    60_000,
  )
}

async function enforceRateLimit(
  event: H3Event,
  store: RateLimitStore,
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const decision = await store.consume(bucket, limit, windowMs)
  if (decision.allowed) return
  setResponseHeader(event, 'retry-after', Math.max(1, Math.ceil(decision.retryAfterMs / 1000)))
  throw createApiError(429, 'security.rate_limited', '请求过于频繁，请稍后重试')
}
