import { randomBytes } from 'node:crypto'
import { setCookie, setResponseHeader } from 'h3'
import {
  csrfCookieName,
  csrfCookieOptions,
  csrfTokenResponseSchema,
} from '../../../shared/contracts/request-security'

export default defineEventHandler((event) => {
  const token = randomBytes(32).toString('base64url')
  setCookie(event, csrfCookieName, token, csrfCookieOptions(process.env.NODE_ENV === 'production'))
  setResponseHeader(event, 'cache-control', 'no-store')
  return csrfTokenResponseSchema.parse({ csrf_token: token })
})
