import {
  createApp,
  eventHandler,
  setResponseStatus,
  toWebHandler,
} from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { csrfCookieName, csrfHeaderName } from '../../../shared/contracts/request-security'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from './rate-limit'
import {
  assertCsrfProof,
  assertSameOrigin,
  enforceNetworkRateLimits,
  enforceFlagSubmissionNetworkRateLimits,
  enforceUserRateLimit,
  isLoopbackIp,
  isPrivateNetworkIp,
  rateLimitBypassMode,
  shouldBypassRateLimitsForRequest,
  shouldBypassRateLimitsForSource,
} from './request-security'

const token = 'c'.repeat(43)

afterEach(() => {
  vi.unstubAllEnvs()
})

async function securedRequest(path: string, options: RequestInit = {}): Promise<Response> {
  const app = createApp()
  app.use(eventHandler(async (event) => {
    try {
      assertSameOrigin(event, 'https://ctf.example.test')
      assertCsrfProof(event)
      return { ok: true }
    }
    catch (error) {
      const response = normalizeApiError(error, '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c')
      setResponseStatus(event, response.statusCode)
      return response.body
    }
  }))
  return toWebHandler(app)(new Request(`https://ctf.example.test${path}`, {
    method: 'POST',
    ...options,
  }))
}

describe('Origin and CSRF enforcement', () => {
  it.each(['/api/auth/password/change', '/api/teams'])('accepts a same-origin protected write to %s with matching double-submit proof', async (path) => {
    const response = await securedRequest(path, {
      headers: {
        origin: 'https://ctf.example.test',
        cookie: `${csrfCookieName}=${token}`,
        [csrfHeaderName]: token,
      },
    })
    expect(response.status).toBe(200)
  })

  it.each(['/api/auth/password/change', '/api/teams'])('rejects missing CSRF proof before a protected write to %s executes', async (path) => {
    const response = await securedRequest(path, {
      headers: { origin: 'https://ctf.example.test' },
    })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'security.csrf_invalid' } })
  })

  it('rejects a cross-origin write even when its CSRF values match', async () => {
    const response = await securedRequest('/api/auth/password/change', {
      headers: {
        origin: 'https://attacker.example',
        cookie: `${csrfCookieName}=${token}`,
        [csrfHeaderName]: token,
      },
    })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'security.origin_invalid' } })
  })

  it('requires Origin but not a Cookie CSRF proof for public reset requests', async () => {
    const response = await securedRequest('/api/auth/password/reset/request', {
      headers: { origin: 'https://ctf.example.test' },
    })
    expect(response.status).toBe(200)
  })
})

describe('layered request limits', () => {
  it('limits a security action by source network and action', async () => {
    vi.stubEnv('RATE_LIMIT_BYPASS', 'false')
    const store = new MemoryRateLimitStore()
    const app = createApp()
    app.use(eventHandler(async (event) => {
      try {
        await enforceNetworkRateLimits(event, store)
        return { ok: true }
      }
      catch (error) {
        const response = normalizeApiError(error, '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c')
        setResponseStatus(event, response.statusCode)
        return response.body
      }
    }))
    const webHandler = toWebHandler(app)
    const request = () => webHandler(new Request('https://ctf.example.test/api/auth/password/reset/request', {
      method: 'POST',
    }))
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await request()).status).toBe(200)
    const rejected = await request()
    expect(rejected.status).toBe(429)
    expect(rejected.headers.get('retry-after')).toBeTruthy()
  })

  it('limits authenticated actions independently by user and action', async () => {
    vi.stubEnv('RATE_LIMIT_BYPASS', 'false')
    const store = new MemoryRateLimitStore()
    const app = createApp()
    app.use(eventHandler(async (event) => {
      try {
        await enforceUserRateLimit(event, store, 'user-a', 'identity.email.verify.request', 2, 60_000)
        return { ok: true }
      }
      catch (error) {
        const response = normalizeApiError(error, '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c')
        setResponseStatus(event, response.statusCode)
        return response.body
      }
    }))
    const webHandler = toWebHandler(app)
    const request = () => webHandler(new Request('https://ctf.example.test/api/auth/email/verification/request'))
    expect((await request()).status).toBe(200)
    expect((await request()).status).toBe(200)
    expect((await request()).status).toBe(429)
  })

  it.each([
    '127.0.0.1',
    '10.20.30.40',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '169.254.10.20',
    '::1',
    '[::1]',
    'fd12:3456:789a::1',
    'fe80::1%en0',
    '::ffff:192.168.1.8',
    '::ffff:c0a8:0108',
  ])('recognizes private network source %s', (ip) => {
    expect(isPrivateNetworkIp(ip)).toBe(true)
  })

  it.each([
    'unknown',
    '0.0.0.0',
    '8.8.8.8',
    '172.15.255.255',
    '172.32.0.0',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
  ])('does not recognize public or unknown source %s as private', (ip) => {
    expect(isPrivateNetworkIp(ip)).toBe(false)
  })

  it.each([
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:0001',
  ])('recognizes loopback source %s', (ip) => {
    expect(isLoopbackIp(ip)).toBe(true)
  })

  it.each([
    '10.0.0.1',
    '192.168.1.1',
    '169.254.1.1',
    'fd00::1',
    'fe80::1',
    '8.8.8.8',
    'unknown',
  ])('does not recognize non-loopback source %s as loopback', (ip) => {
    expect(isLoopbackIp(ip)).toBe(false)
  })

  it('defaults the source bypass mode to loopback only', () => {
    expect(rateLimitBypassMode(undefined)).toBe('local')
    expect(rateLimitBypassMode('invalid')).toBe('local')
    expect(shouldBypassRateLimitsForSource('127.0.0.1', 'false')).toBe(false)
    expect(shouldBypassRateLimitsForSource('127.0.0.1', 'local')).toBe(true)
    expect(shouldBypassRateLimitsForSource('10.0.0.1', 'local')).toBe(false)
    expect(shouldBypassRateLimitsForSource('10.0.0.1', 'private')).toBe(true)
    expect(shouldBypassRateLimitsForSource('8.8.8.8', 'private')).toBe(false)
    expect(shouldBypassRateLimitsForSource('8.8.8.8', 'true')).toBe(true)
    expect(shouldBypassRateLimitsForSource('unknown', 'true')).toBe(true)
  })

  it('treats an unknown peer as local only when the request target is loopback', async () => {
    vi.stubEnv('RATE_LIMIT_BYPASS', 'local')
    vi.stubEnv('NUXT_PUBLIC_SITE_URL', 'http://127.0.0.1:3000')
    const app = createApp()
    app.use(eventHandler(event => ({ bypass: shouldBypassRateLimitsForRequest(event) })))
    const webHandler = toWebHandler(app)
    const bypass = async (url: string) => (await webHandler(new Request(url))).json()

    await expect(bypass('http://127.0.0.1/api/test'))
      .resolves.toEqual({ bypass: true })
    await expect(bypass('http://[::1]/api/test'))
      .resolves.toEqual({ bypass: true })
    vi.stubEnv('NUXT_PUBLIC_SITE_URL', 'https://ctf.example.test')
    await expect(bypass('http://127.0.0.1/api/test'))
      .resolves.toEqual({ bypass: false })
  })

  it('skips network limits for private sources when explicitly configured', async () => {
    vi.stubEnv('RATE_LIMIT_BYPASS', 'private')
    vi.stubEnv('TRUST_PROXY', 'true')
    const store = new MemoryRateLimitStore()
    const app = createApp()
    app.use(eventHandler(async (event) => {
      try {
        await enforceNetworkRateLimits(event, store)
        return { ok: true }
      }
      catch (error) {
        const response = normalizeApiError(error, '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c')
        setResponseStatus(event, response.statusCode)
        return response.body
      }
    }))
    const webHandler = toWebHandler(app)
    const request = () => webHandler(new Request('https://ctf.example.test/api/auth/login', {
      method: 'POST',
      headers: { 'x-forwarded-for': '192.168.1.10' },
    }))
    for (let attempt = 0; attempt < 20; attempt += 1) expect((await request()).status).toBe(200)
  })

  it('continues to limit public sources when private bypass is enabled', async () => {
    vi.stubEnv('RATE_LIMIT_BYPASS', 'private')
    vi.stubEnv('TRUST_PROXY', 'true')
    const store = new MemoryRateLimitStore()
    const app = createApp()
    app.use(eventHandler(async (event) => {
      try {
        await enforceNetworkRateLimits(event, store)
        return { ok: true }
      }
      catch (error) {
        const response = normalizeApiError(error, '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c')
        setResponseStatus(event, response.statusCode)
        return response.body
      }
    }))
    const webHandler = toWebHandler(app)
    const request = () => webHandler(new Request('https://ctf.example.test/api/auth/login', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.10' },
    }))
    for (let attempt = 0; attempt < 10; attempt += 1) expect((await request()).status).toBe(200)
    expect((await request()).status).toBe(429)
  })

  it('also skips user limits for a selected source', async () => {
    vi.stubEnv('RATE_LIMIT_BYPASS', 'local')
    vi.stubEnv('TRUST_PROXY', 'true')
    const store = new MemoryRateLimitStore()
    const app = createApp()
    app.use(eventHandler(async (event) => {
      try {
        await enforceUserRateLimit(event, store, 'user-a', 'identity.email.verify.request', 1, 60_000)
        return { ok: true }
      }
      catch (error) {
        const response = normalizeApiError(error, '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c')
        setResponseStatus(event, response.statusCode)
        return response.body
      }
    }))
    const webHandler = toWebHandler(app)
    const request = () => webHandler(new Request('https://ctf.example.test/api/auth/email/verification/request', {
      headers: { 'x-forwarded-for': '127.0.0.1' },
    }))
    expect((await request()).status).toBe(200)
    expect((await request()).status).toBe(200)
  })

  it('isolates network submission limits per challenge', async () => {
    vi.stubEnv('RATE_LIMIT_BYPASS', 'false')
    const store = new MemoryRateLimitStore()
    const app = createApp()
    app.use(eventHandler(async (event) => {
      try {
        await enforceFlagSubmissionNetworkRateLimits(event, store, 'challenge-a')
        return { ok: true }
      }
      catch (error) {
        const response = normalizeApiError(error, '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c')
        setResponseStatus(event, response.statusCode)
        return response.body
      }
    }))
    const webHandler = toWebHandler(app)
    const request = () => webHandler(new Request('https://ctf.example.test/api/contests/x/challenges/y/submissions', {
      method: 'POST',
    }))
    for (let attempt = 0; attempt < 30; attempt += 1) expect((await request()).status).toBe(200)
    expect((await request()).status).toBe(429)
  })
})
