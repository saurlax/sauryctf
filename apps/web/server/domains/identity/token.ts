import type { EmailTokenPurpose } from './repository'

export interface IdentityTokenCodec {
  generate(): string
  digest(token: string): Buffer
}

export interface IssuedIdentityToken {
  token: string
  purpose: EmailTokenPurpose
  expiresAt: Date
}

export interface PasswordResetRequestResult {
  accepted: true
  delivery: ({ userId: string, emailNormalized: string } & IssuedIdentityToken) | null
}
