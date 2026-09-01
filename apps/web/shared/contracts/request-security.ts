import { z } from 'zod'

export const csrfTokenSchema = z.string().length(43).regex(/^[A-Za-z0-9_-]+$/u)

export const csrfTokenResponseSchema = z.strictObject({
  csrf_token: csrfTokenSchema,
})

export type CsrfTokenResponse = z.infer<typeof csrfTokenResponseSchema>

export const csrfCookieName = 'sauryctf-csrf'
export const csrfHeaderName = 'x-csrf-token'

export function csrfCookieOptions(isProduction: boolean) {
  return {
    httpOnly: false as const,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/' as const,
    maxAge: 60 * 60,
  }
}
