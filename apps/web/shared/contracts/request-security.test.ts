import { describe, expect, it } from 'vitest'
import { csrfCookieOptions, csrfTokenResponseSchema } from './request-security'

describe('request security contract', () => {
  it('accepts exactly one base64url CSRF token', () => {
    expect(csrfTokenResponseSchema.parse({ csrf_token: 'a'.repeat(43) })).toEqual({
      csrf_token: 'a'.repeat(43),
    })
    expect(() => csrfTokenResponseSchema.parse({ csrf_token: 'a'.repeat(42) })).toThrow()
    expect(() => csrfTokenResponseSchema.parse({ csrf_token: 'a'.repeat(43), session: true })).toThrow()
  })

  it('keeps the double-submit cookie script-readable and same-site constrained', () => {
    expect(csrfCookieOptions(false)).toMatchObject({
      httpOnly: false,
      secure: false,
      sameSite: 'lax',
      path: '/',
    })
    expect(csrfCookieOptions(true).secure).toBe(true)
  })
})
