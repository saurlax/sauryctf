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
  status: 'active' | 'banned' | 'deleted'
}

export interface RegisteredIdentity {
  userId: string
  sessionVersion: number
}

export interface DefaultAdministratorBootstrapResult {
  created: boolean
  identity: RegisteredIdentity | null
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
export type ManagedUserStatus = 'active' | 'banned'

export interface ManagedIdentity {
  userId: string
  username: string
  email: string
  emailVerified: boolean
  status: ManagedUserStatus
  role: GlobalRole
  sessionVersion: number
  mustChangePassword: boolean
  createdAt: Date
}

export interface ManagedIdentityPage {
  items: ManagedIdentity[]
  nextCursor: string | null
  hasMore: boolean
}

export interface GlobalRoleMutationResult {
  userId: string
  previousRole: GlobalRole
  role: GlobalRole
  sessionVersion: number
  changed: boolean
}

export interface UserStatusMutationResult {
  userId: string
  previousStatus: ManagedUserStatus
  status: ManagedUserStatus
  sessionVersion: number
  changed: boolean
}

export interface ChangeGlobalRoleCommand {
  actorId: string
  targetUserId: string
  role: GlobalRole
  reason: string
  requestId: string
  changedAt: Date
}

export interface ChangeUserStatusCommand {
  actorId: string
  targetUserId: string
  status: ManagedUserStatus
  reason: string
  requestId: string
  changedAt: Date
}

export interface NewEmailToken {
  userId: string
  purpose: EmailTokenPurpose
  tokenDigest: Buffer
  targetEmailNormalized: string
  expiresAt: Date
  issuedAt: Date
  tokenEnvelope: string
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
  bootstrapDefaultAdministrator(identity: NewIdentity): Promise<DefaultAdministratorBootstrapResult>
  findByLoginIdentifier(identifierNormalized: string): Promise<StoredIdentity | null>
  findCredential(userId: string): Promise<StoredCredential | null>
  findPasswordResetRecipient(emailNormalized: string): Promise<PasswordResetRecipient | null>
  findSessionSubject(userId: string): Promise<SessionSubject | null>
  listManagedIdentities(cursor: string | undefined, limit: number): Promise<ManagedIdentityPage>
  replacePasswordHash(userId: string, previousHash: string, nextHash: string): Promise<boolean>
  changePassword(userId: string, previousHash: string, nextHash: string, changedAt: Date): Promise<PasswordMutationResult>
  resetPassword(tokenDigest: Buffer, nextHash: string, consumedAt: Date): Promise<PasswordMutationResult>
  issueEmailToken(token: NewEmailToken): Promise<void>
  verifyEmail(tokenDigest: Buffer, consumedAt: Date): Promise<PasswordMutationResult>
  changeGlobalRole(command: ChangeGlobalRoleCommand): Promise<GlobalRoleMutationResult>
  changeUserStatus(command: ChangeUserStatusCommand): Promise<UserStatusMutationResult>
  changeEmail(
    userId: string,
    email: string,
    emailNormalized: string,
    changedAt: Date,
  ): Promise<PasswordMutationResult>
}

export class IdentityConflictError extends Error {
  constructor() {
    super('Identity already exists')
    this.name = 'IdentityConflictError'
  }
}

export class PublicRegistrationDisabledError extends Error {
  constructor() {
    super('Public registration is disabled')
    this.name = 'PublicRegistrationDisabledError'
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
