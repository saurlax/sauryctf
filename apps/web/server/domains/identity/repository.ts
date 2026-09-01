export interface NewIdentity {
  username: string
  usernameNormalized: string
  email: string
  emailNormalized: string
  passwordHash: string
}

export interface StoredIdentity {
  userId: string
  username: string
  email: string
  passwordHash: string
  sessionVersion: number
}

export interface RegisteredIdentity {
  userId: string
  sessionVersion: number
}

export type EmailTokenPurpose = 'verify_email' | 'reset_password'

export interface StoredCredential {
  userId: string
  passwordHash: string
}

export interface PasswordMutationResult {
  userId: string
  sessionVersion: number
}

export type GlobalRole = 'user' | 'organizer' | 'admin'

export interface GlobalRoleMutationResult {
  userId: string
  previousRole: GlobalRole
  role: GlobalRole
  sessionVersion: number
  changed: boolean
}

export interface NewEmailToken {
  userId: string
  purpose: EmailTokenPurpose
  tokenDigest: Buffer
  targetEmailNormalized: string
  expiresAt: Date
  issuedAt: Date
}

export interface PasswordResetRecipient {
  userId: string
  emailNormalized: string
}

export interface SessionSubject {
  userId: string
  username: string
  email: string
  emailVerified: boolean
  status: 'active' | 'banned'
  role: GlobalRole
  sessionVersion: number
  mustChangePassword: boolean
}

export interface IdentityRepository {
  createIdentity(identity: NewIdentity): Promise<RegisteredIdentity>
  findByLoginIdentifier(identifierNormalized: string): Promise<StoredIdentity | null>
  findCredential(userId: string): Promise<StoredCredential | null>
  findPasswordResetRecipient(emailNormalized: string): Promise<PasswordResetRecipient | null>
  findSessionSubject(userId: string): Promise<SessionSubject | null>
  replacePasswordHash(userId: string, previousHash: string, nextHash: string): Promise<boolean>
  changePassword(userId: string, previousHash: string, nextHash: string, changedAt: Date): Promise<PasswordMutationResult>
  resetPassword(tokenDigest: Buffer, nextHash: string, consumedAt: Date): Promise<PasswordMutationResult>
  issueEmailToken(token: NewEmailToken): Promise<void>
  verifyEmail(tokenDigest: Buffer, consumedAt: Date): Promise<PasswordMutationResult>
  changeGlobalRole(userId: string, role: GlobalRole, changedAt: Date): Promise<GlobalRoleMutationResult>
}

export class IdentityConflictError extends Error {
  constructor() {
    super('Identity already exists')
    this.name = 'IdentityConflictError'
  }
}

export class IdentityMutationConflictError extends Error {
  constructor() {
    super('Identity changed concurrently')
    this.name = 'IdentityMutationConflictError'
  }
}

export class InvalidEmailTokenError extends Error {
  constructor() {
    super('Email token is invalid or expired')
    this.name = 'InvalidEmailTokenError'
  }
}

export class IdentityNotFoundError extends Error {
  constructor() {
    super('Identity does not exist')
    this.name = 'IdentityNotFoundError'
  }
}
