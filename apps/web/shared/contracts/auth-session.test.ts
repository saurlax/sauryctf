import { createApp, eventHandler, toWebHandler, unsealSession, useSession } from 'h3'
import { describe, expect, it } from 'vitest'
import { authSessionDataSchema, sessionCookieOptions } from './auth-session'

const password = 'test-session-password-that-is-longer-than-32-characters'
const sessionData = {
  user_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c',
  session_version: 7,
  logged_in_at: '2026-09-01T07:08:09.123Z',
}

describe('sealed browser session contract', () => {
  it('allows exactly the minimum public authentication payload', () => {
    expect(authSessionDataSchema.parse(sessionData)).toEqual(sessionData)
    expect(() => authSessionDataSchema.parse({ ...sessionData, role: 'admin' })).toThrow()
    expect(() => authSessionDataSchema.parse({ ...sessionData, email: 'user@example.test' })).toThrow()
    expect(() => authSessionDataSchema.parse({ ...sessionData, credential: 'secret' })).toThrow()
  })

  it.each([
    [false, false],
    [true, true],
  ])('sets HttpOnly, SameSite=Lax and production Secure flags', async (isProduction, secure) => {
    const config = {
      name: 'sauryctf-session',
      password,
      cookie: sessionCookieOptions(isProduction),
    }
    const app = createApp()
    app.use(eventHandler(async (event) => {
      const session = await useSession(event, config)
      await session.update(authSessionDataSchema.parse(sessionData))
      return { ok: true }
    }))

    const response = await toWebHandler(app)(new Request('https://ctf.example.test/session'))
    const cookie = response.headers.get('set-cookie')

    expect(cookie).toContain('sauryctf-session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie?.includes('Secure')).toBe(secure)

    const sealed = cookie?.match(/sauryctf-session=([^;]+)/u)?.[1]
    expect(sealed).toBeTruthy()
    const unsealed = await unsealSession({ request: { headers: new Headers() }, context: {} }, config, sealed!)
    expect(unsealed.data).toEqual(sessionData)
    expect(unsealed.data).not.toHaveProperty('role')
    expect(unsealed.data).not.toHaveProperty('email')
    expect(unsealed.data).not.toHaveProperty('credential')
  })
})
