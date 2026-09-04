import { timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import type { H3Event } from 'h3'
import {
  getCookie,
  getRequestHeader,
  getRequestIP,
  getRequestURL,
  setResponseHeader,
} from 'h3'
import { defaultSiteUrl } from '../../../shared/contracts/deployment-config'
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
  if (shouldBypassRateLimitsForRequest(event, ip)) return
  await enforceRateLimitPolicies(event, store, [
    { bucket: rateLimitBucket('network', ip, 'identity.security'), limit: 120, windowMs: 60_000 },
    { bucket: rateLimitBucket('network', ip, policy.action), limit: policy.limit, windowMs: policy.windowMs },
  ])
}

export function getClientIp(event: H3Event): string {
  const trustProxy = process.env.TRUST_PROXY === 'true'
  return getRequestIP(event, { xForwardedFor: trustProxy }) || 'unknown'
}

export type RateLimitBypassMode = 'false' | 'local' | 'private' | 'true'

export function rateLimitBypassMode(value = process.env.RATE_LIMIT_BYPASS): RateLimitBypassMode {
  if (value === 'false') return 'false'
  return value === 'private' || value === 'true' ? value : 'local'
}

export function shouldBypassRateLimitsForSource(
  ip: string,
  mode = rateLimitBypassMode(),
): boolean {
  if (mode === 'true') return true
  if (mode === 'local') return isLoopbackIp(ip)
  if (mode === 'private') return isPrivateNetworkIp(ip)
  return false
}

export function shouldBypassRateLimitsForRequest(event: H3Event, ip = getClientIp(event)): boolean {
  const mode = rateLimitBypassMode()
  if (shouldBypassRateLimitsForSource(ip, mode)) return true
  if (mode === 'false' || ip !== 'unknown') return false

  // Nitro's local development adapter can omit the peer socket address. Only
  // fall back when both the configured origin and request target are local.
  return isLoopbackHostname(getRequestURL(event).hostname)
    && isLoopbackOrigin(process.env.NUXT_PUBLIC_SITE_URL || defaultSiteUrl)
}

function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  try {
    return isLoopbackHostname(new URL(origin).hostname)
  }
  catch {
    return false
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || isLoopbackIp(normalized)
}

export function isLoopbackIp(ip: string): boolean {
  const address = normalizeIp(ip)
  const family = isIP(address)
  if (family === 4) return address.split('.')[0] === '127'
  if (family !== 6) return false

  const words = expandIpv6(address)
  if (!words) return false
  if (words.slice(0, 7).every(word => word === 0) && words[7] === 1) return true
  const mappedIpv4 = mappedIpv4Address(words)
  return mappedIpv4 ? isLoopbackIp(mappedIpv4) : false
}

export function isPrivateNetworkIp(ip: string): boolean {
  const address = normalizeIp(ip)
  const family = isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family !== 6) return false

  const words = expandIpv6(address)
  if (!words) return false
  if (isLoopbackIp(address)) return true
  if ((words[0]! & 0xfe00) === 0xfc00) return true
  if ((words[0]! & 0xffc0) === 0xfe80) return true
  const mappedIpv4 = mappedIpv4Address(words)
  return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false
}

function normalizeIp(ip: string): string {
  const address = ip.split('%', 1)[0]?.toLowerCase() || ''
  return address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address
}

function mappedIpv4Address(words: number[]): string | undefined {
  if (!words.slice(0, 5).every(word => word === 0) || words[5] !== 0xffff) return undefined
  return [
    words[6]! >> 8,
    words[6]! & 0xff,
    words[7]! >> 8,
    words[7]! & 0xff,
  ].join('.')
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  return octets[0] === 127
    || octets[0] === 10
    || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 169 && octets[1] === 254)
}

function expandIpv6(address: string): number[] | undefined {
  let normalized = address
  const dottedTail = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/u)?.[1]
  if (dottedTail) {
    const octets = dottedTail.split('.').map(Number)
    normalized = normalized.slice(0, -dottedTail.length)
      + ((octets[0]! << 8) | octets[1]!).toString(16)
      + ':'
      + ((octets[2]! << 8) | octets[3]!).toString(16)
  }

  const sides = normalized.split('::')
  if (sides.length > 2) return undefined
  const left = sides[0] ? sides[0].split(':') : []
  const right = sides[1] ? sides[1].split(':') : []
  const missing = 8 - left.length - right.length
  if (missing < 0 || (sides.length === 1 && missing !== 0)) return undefined
  const parts = sides.length === 2
    ? [...left, ...Array.from({ length: missing }, () => '0'), ...right]
    : left
  if (parts.length !== 8) return undefined
  return parts.map(part => Number.parseInt(part, 16))
}

export async function enforceUserRateLimit(
  event: H3Event,
  store: RateLimitStore,
  userId: string,
  action: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  if (shouldBypassRateLimitsForRequest(event)) return
  await enforceRateLimit(event, store, rateLimitBucket('user', userId, action), limit, windowMs)
}

export async function enforceFlagSubmissionNetworkRateLimits(
  event: H3Event,
  store: RateLimitStore,
  challengeId: string,
): Promise<void> {
  const ip = getClientIp(event)
  if (shouldBypassRateLimitsForRequest(event, ip)) return
  await enforceRateLimitPolicies(event, store, [
    {
      bucket: rateLimitBucket('network', ip, 'submission.flag'),
      limit: 120,
      windowMs: 60_000,
    },
    {
      bucket: rateLimitBucket('network', `${ip}\0${challengeId}`, 'submission.flag.challenge'),
      limit: 30,
      windowMs: 60_000,
    },
  ])
}

async function enforceRateLimitPolicies(
  event: H3Event,
  store: RateLimitStore,
  policies: Parameters<RateLimitStore['consumeMany']>[0],
): Promise<void> {
  const decisions = await store.consumeMany(policies)
  const retryAfterMs = decisions.reduce(
    (maximum, decision) => decision.allowed ? maximum : Math.max(maximum, decision.retryAfterMs),
    0,
  )
  if (retryAfterMs <= 0) return
  rejectRateLimit(event, retryAfterMs)
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
  rejectRateLimit(event, decision.retryAfterMs)
}

function rejectRateLimit(event: H3Event, retryAfterMs: number): never {
  setResponseHeader(event, 'retry-after', Math.max(1, Math.ceil(retryAfterMs / 1000)))
  throw createApiError(429, 'security.rate_limited', '请求过于频繁，请稍后重试')
}
