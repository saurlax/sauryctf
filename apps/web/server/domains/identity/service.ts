import type { PasswordHasher } from './password'
import {
  IdentityConflictError,
  IdentityMutationConflictError,
  InvalidEmailTokenError,
  type IdentityRepository,
  type PasswordMutationResult,
  type RegisteredIdentity,
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

export type IdentityServiceErrorCode =
  | 'identity.conflict'
  | 'identity.invalid_credentials'
  | 'identity.password_unchanged'
  | 'identity.token_invalid'

export class IdentityServiceError extends Error {
  constructor(readonly code: IdentityServiceErrorCode) {
    const messages: Record<IdentityServiceErrorCode, string> = {
      'identity.conflict': '账号标识已被使用',
      'identity.invalid_credentials': '账号或密码错误',
      'identity.password_unchanged': '密码已被其他请求修改，请重新登录',
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
      throw error
    }
  }

  async login(input: LoginIdentityInput): Promise<LoginIdentityResult> {
    assertPasswordInput(input.password)
    const identity = await this.repository.findByLoginIdentifier(normalizeEmail(input.identifier))
    if (!identity || !await this.passwords.verify(identity.passwordHash, input.password)) {
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

  private requireTokenCodec(): IdentityTokenCodec {
    if (!this.tokens) throw new Error('Identity token codec is not configured')
    return this.tokens
  }
}
