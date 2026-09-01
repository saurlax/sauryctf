import type { ResourceVersion, UTCTimestamp, UUID } from '../contracts/common-types'

declare module '#auth-utils' {
  interface UserSession {
    user_id?: UUID
    session_version?: ResourceVersion
    logged_in_at?: UTCTimestamp
  }
}

export {}
