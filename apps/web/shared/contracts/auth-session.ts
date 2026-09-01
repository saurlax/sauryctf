import { z } from 'zod'
import {
  resourceVersionSchema,
  utcTimestampSchema,
  uuidSchema,
} from './common-types'

export const authSessionDataSchema = z.strictObject({
  user_id: uuidSchema,
  session_version: resourceVersionSchema,
  logged_in_at: utcTimestampSchema,
})

export type AuthSessionData = z.infer<typeof authSessionDataSchema>

export function sessionCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true as const,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/' as const,
  }
}
