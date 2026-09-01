import type { PasswordHasher } from './password'
import type { IdentityMailTokenProtector } from './delivery'
import { identityCapability, requireIdentityCapability } from './capabilities'
import {
  IdentityConflictError,
  IdentityMutationConflictError,
  IdentityNotFoundError,
  InvalidEmailTokenError,
  PublicRegistrationDisabledError,
  type GlobalRole,
  type GlobalRoleMutationResult,
  type ManagedIdentityPage,
  type ManagedUserStatus,
  type DefaultAdministratorBootstrapResult,
  type IdentityRepository,
  type PasswordMutationResult,
  type RegisteredIdentity,
  type SessionSubject,
  type UserStatusMutationResult,
} from './repository'
import type { IdentityTokenCodec, IssuedIdentityToken, PasswordResetRequestResult } from './token'

export interface RegisterIdentityInput {
  username: string
  email: string
  password: string
}

export interface LoginIdentityInput {
  identifier: string
  password: string
}

export interface LoginIdentityResult {
  userId: string
  sessionVersion: number
  passwordHashUpgraded: boolean
}

export const defaultAdministrator = {
  username: 'admin',
  password: 'sauryctf',
  placeholderEmail: 'admin@bootstrap.invalid',
} as const

export type IdentityServiceErrorCode =
  | 'identity.conflict'
  | 'identity.invalid_credentials'
  | 'identity.not_found'
  | 'identity.password_unchanged'
  | 'identity.registration_disabled'
  | 'identity.self_management_forbidden'
  | 'identity.token_invalid'

export class IdentityServiceError extends Error {
  constructor(readonly code: IdentityServiceErrorCode) {
    const messages: Record<IdentityServiceErrorCode, string> = {
      'identity.conflict': '账号标识已被使用',
      'identity.invalid_credentials': '账号或密码错误',
      'identity.not_found': '账号不存在',
      'identity.password_unchanged': '密码已被其他请求修改，请重新登录',
      'identity.registration_disabled': '平台当前未开放公开注册',
      'identity.self_management_forbidden': '不能在用户管理中修改当前账号',
      'identity.token_invalid': '凭证无效或已过期',
    }
    super(messages[code])
    this.name = 'IdentityServiceError'
  }
}

export function normalizeUsername(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

export function normalizeEmail(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

function assertPasswordInput(password: string): void {
  if (password.length === 0 || Buffer.byteLength(password, 'utf8') > 1024) {
    throw new IdentityServiceError('identity.invalid_credentials')
  }
}

export class IdentityService {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly passwords: PasswordHasher,
    private readonly tokens?: IdentityTokenCodec,
    private readonly now: () => Date = () => new Date(),
    private readonly mailTokens?: IdentityMailTokenProtector,
  ) {}

  async register(input: RegisterIdentityInput): Promise<RegisteredIdentity> {
    assertPasswordInput(input.password)
    const username = input.username.normalize('NFKC').trim()
    const email = input.email.normalize('NFKC').trim()
    const passwordHash = await this.passwords.hash(input.password)

    try {
      return await this.repository.createIdentity({
        username,
        usernameNormalized: normalizeUsername(username),
        email,
        emailNormalized: normalizeEmail(email),
        passwordHash,
      })
    }
    catch (error) {
      if (error instanceof IdentityConflictError) {
        throw new IdentityServiceError('identity.conflict')
      }
      if (error instanceof PublicRegistrationDisabledError) {
        throw new IdentityServiceError('identity.registration_disabled')
      }
      throw error
    }
  }

  async bootstrapDefaultAdministrator(): Promise<DefaultAdministratorBootstrapResult> {
    const passwordHash = await this.passwords.hash(defaultAdministrator.password)
    return this.repository.bootstrapDefaultAdministrator({
      username: defaultAdministrator.username,
      usernameNormalized: normalizeUsername(defaultAdministrator.username),
      email: defaultAdministrator.placeholderEmail,
      emailNormalized: normalizeEmail(defaultAdministrator.placeholderEmail),
      passwordHash,
    })
  }

  async login(input: LoginIdentityInput): Promise<LoginIdentityResult> {
    assertPasswordInput(input.password)
    const identity = await this.repository.findByLoginIdentifier(normalizeEmail(input.identifier))
    if (!identity || identity.status !== 'active' || !await this.passwords.verify(identity.passwordHash, input.password)) {
      throw new IdentityServiceError('identity.invalid_credentials')
    }

    let passwordHashUpgraded = false
    if (this.passwords.needsRehash(identity.passwordHash)) {
      const upgradedHash = await this.passwords.hash(input.password)
      passwordHashUpgraded = await this.repository.replacePasswordHash(
        identity.userId,
        identity.passwordHash,
        upgradedHash,
      )
    }

    return {
      userId: identity.userId,
      sessionVersion: identity.sessionVersion,
      passwordHashUpgraded,
    }
  }

  async changePassword(userId: string, currentPassword: string, nextPassword: string): Promise<PasswordMutationResult> {
    assertPasswordInput(currentPassword)
    assertPasswordInput(nextPassword)
    const credential = await this.repository.findCredential(userId)
    if (!credential || !await this.passwords.verify(credential.passwordHash, currentPassword)) {
      throw new IdentityServiceError('identity.invalid_credentials')
    }
    const nextHash = await this.passwords.hash(nextPassword)
    try {
      return await this.repository.changePassword(userId, credential.passwordHash, nextHash, this.now())
    }
    catch (error) {
      if (error instanceof IdentityMutationConflictError) {
        throw new IdentityServiceError('identity.password_unchanged')
      }
      throw error
    }
  }

  async changeEmail(userId: string, nextEmail: string): Promise<PasswordMutationResult> {
    const email = nextEmail.normalize('NFKC').trim()
    try {
      return await this.repository.changeEmail(userId, email, normalizeEmail(email), this.now())
    }
    catch (error) {
      if (error instanceof IdentityConflictError) throw new IdentityServiceError('identity.conflict')
      if (error instanceof IdentityNotFoundError) throw new IdentityServiceError('identity.not_found')
      throw error
    }
  }

  async requestPasswordReset(email: string, lifetimeMs = 15 * 60 * 1000): Promise<PasswordResetRequestResult> {
    const codec = this.requireTokenCodec()
    const recipient = await this.repository.findPasswordResetRecipient(normalizeEmail(email))
    if (!recipient) return { accepted: true, delivery: null }

    const issuedAt = this.now()
    const token = codec.generate()
    const expiresAt = new Date(issuedAt.getTime() + lifetimeMs)
    await this.repository.issueEmailToken({
      userId: recipient.userId,
      purpose: 'reset_password',
      tokenDigest: codec.digest(token),
      targetEmailNormalized: recipient.emailNormalized,
      expiresAt,
      issuedAt,
      tokenEnvelope: this.requireMailTokenProtector().protect(token),
    })
    return {
      accepted: true,
      delivery: {
        userId: recipient.userId,
        emailNormalized: recipient.emailNormalized,
        token,
        purpose: 'reset_password',
        expiresAt,
      },
    }
  }

  async resetPassword(token: string, nextPassword: string): Promise<PasswordMutationResult> {
    assertPasswordInput(nextPassword)
    const codec = this.requireTokenCodec()
    const nextHash = await this.passwords.hash(nextPassword)
    try {
      return await this.repository.resetPassword(codec.digest(token), nextHash, this.now())
    }
    catch (error) {
      if (error instanceof InvalidEmailTokenError) throw new IdentityServiceError('identity.token_invalid')
      throw error
    }
  }

  async requestEmailVerification(userId: string, lifetimeMs = 30 * 60 * 1000): Promise<IssuedIdentityToken> {
    const codec = this.requireTokenCodec()
    const subject = await this.repository.findSessionSubject(userId)
    if (!subject || subject.status !== 'active') throw new IdentityServiceError('identity.invalid_credentials')
    const issuedAt = this.now()
    const token = codec.generate()
    const expiresAt = new Date(issuedAt.getTime() + lifetimeMs)
    await this.repository.issueEmailToken({
      userId,
      purpose: 'verify_email',
      tokenDigest: codec.digest(token),
      targetEmailNormalized: normalizeEmail(subject.email),
      expiresAt,
      issuedAt,
      tokenEnvelope: this.requireMailTokenProtector().protect(token),
    })
    return { token, purpose: 'verify_email', expiresAt }
  }

  async verifyEmail(token: string): Promise<PasswordMutationResult> {
    const codec = this.requireTokenCodec()
    try {
      return await this.repository.verifyEmail(codec.digest(token), this.now())
    }
    catch (error) {
      if (error instanceof InvalidEmailTokenError) throw new IdentityServiceError('identity.token_invalid')
      throw error
    }
  }

  async changeGlobalRole(
    actor: SessionSubject,
    targetUserId: string,
    role: GlobalRole,
  ): Promise<GlobalRoleMutationResult> {
    requireIdentityCapability(actor, identityCapability.roleManage)
    if (actor.userId === targetUserId) {
      throw new IdentityServiceError('identity.self_management_forbidden')
    }
    try {
      return await this.repository.changeGlobalRole(targetUserId, role, this.now())
    }
    catch (error) {
      if (error instanceof IdentityNotFoundError) throw new IdentityServiceError('identity.not_found')
      throw error
    }
  }

  async listManagedIdentities(
    actor: SessionSubject,
    cursor: string | undefined,
    limit: number,
  ): Promise<ManagedIdentityPage> {
    requireIdentityCapability(actor, identityCapability.userManage)
    return this.repository.listManagedIdentities(cursor, limit)
  }

  async changeUserStatus(
    actor: SessionSubject,
    targetUserId: string,
    status: ManagedUserStatus,
  ): Promise<UserStatusMutationResult> {
    requireIdentityCapability(actor, identityCapability.userManage)
    if (actor.userId === targetUserId) {
      throw new IdentityServiceError('identity.self_management_forbidden')
    }
    try {
      return await this.repository.changeUserStatus(targetUserId, status, this.now())
    }
    catch (error) {
      if (error instanceof IdentityNotFoundError) throw new IdentityServiceError('identity.not_found')
      throw error
    }
  }

  private requireTokenCodec(): IdentityTokenCodec {
    if (!this.tokens) throw new Error('Identity token codec is not configured')
    return this.tokens
  }

  private requireMailTokenProtector(): IdentityMailTokenProtector {
    if (!this.mailTokens) throw new Error('Identity mail token protector is not configured')
    return this.mailTokens
  }
}
