import {
  createApp,
  eventHandler,
  setResponseStatus,
  toWebHandler,
} from 'h3'
import { describe, expect, it } from 'vitest'
import { csrfCookieName, csrfHeaderName } from '../../../shared/contracts/request-security'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from './rate-limit'
import {
  assertCsrfProof,
  assertSameOrigin,
  enforceNetworkRateLimits,
  enforceUserRateLimit,
} from './request-security'

const token = 'c'.repeat(43)

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
  it('accepts a same-origin protected write with matching double-submit proof', async () => {
    const response = await securedRequest('/api/auth/password/change', {
      headers: {
        origin: 'https://ctf.example.test',
        cookie: `${csrfCookieName}=${token}`,
        [csrfHeaderName]: token,
      },
    })
    expect(response.status).toBe(200)
  })

  it('rejects missing CSRF proof before a protected write executes', async () => {
    const response = await securedRequest('/api/auth/password/change', {
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
})
