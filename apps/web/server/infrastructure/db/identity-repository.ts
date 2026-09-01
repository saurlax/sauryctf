import type { Pool } from 'pg'
import {
  IdentityConflictError,
  IdentityMutationConflictError,
  InvalidEmailTokenError,
  type IdentityRepository,
  type NewEmailToken,
  type NewIdentity,
  type PasswordMutationResult,
  type PasswordResetRecipient,
  type RegisteredIdentity,
  type SessionSubject,
  type StoredCredential,
  type StoredIdentity,
} from '../../domains/identity/repository'

interface PostgresErrorLike {
  code?: unknown
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as PostgresErrorLike).code === '23505'
}

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(private readonly pool: Pool) {}

  async createIdentity(identity: NewIdentity): Promise<RegisteredIdentity> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const user = await connection.query<{ id: string, session_version: string }>(
        `INSERT INTO users (username, username_normalized, email, email_normalized)
         VALUES ($1, $2, $3, $4)
         RETURNING id, session_version::text`,
        [identity.username, identity.usernameNormalized, identity.email, identity.emailNormalized],
      )
      const created = user.rows[0]!
      await connection.query(
        `INSERT INTO credentials (user_id, algorithm, password_hash)
         VALUES ($1, 'scrypt', $2)`,
        [created.id, identity.passwordHash],
      )
      await connection.query(
        `INSERT INTO user_roles (user_id, role)
         VALUES ($1, 'user')`,
        [created.id],
      )
      await connection.query('COMMIT')
      return { userId: created.id, sessionVersion: Number(created.session_version) }
    }
    catch (error) {
      await connection.query('ROLLBACK')
      if (isUniqueViolation(error)) throw new IdentityConflictError()
      throw error
    }
    finally {
      connection.release()
    }
  }

  async findByLoginIdentifier(identifierNormalized: string): Promise<StoredIdentity | null> {
    const result = await this.pool.query<{
      id: string
      username: string
      email: string
      password_hash: string
      session_version: string
    }>(
      `SELECT u.id, u.username, u.email, c.password_hash, u.session_version::text
       FROM users u
       JOIN credentials c ON c.user_id = u.id
       WHERE u.username_normalized = $1 OR u.email_normalized = $1
       LIMIT 1`,
      [identifierNormalized],
    )
    const identity = result.rows[0]
    if (!identity) return null
    return {
      userId: identity.id,
      username: identity.username,
      email: identity.email,
      passwordHash: identity.password_hash,
      sessionVersion: Number(identity.session_version),
    }
  }

  async findCredential(userId: string): Promise<StoredCredential | null> {
    const result = await this.pool.query<{ user_id: string, password_hash: string }>(
      `SELECT user_id, password_hash FROM credentials WHERE user_id = $1`,
      [userId],
    )
    const credential = result.rows[0]
    return credential ? { userId: credential.user_id, passwordHash: credential.password_hash } : null
  }

  async findPasswordResetRecipient(emailNormalized: string): Promise<PasswordResetRecipient | null> {
    const result = await this.pool.query<{ id: string, email_normalized: string }>(
      `SELECT id, email_normalized
       FROM users
       WHERE email_normalized = $1 AND status = 'active'`,
      [emailNormalized],
    )
    const recipient = result.rows[0]
    return recipient ? { userId: recipient.id, emailNormalized: recipient.email_normalized } : null
  }

  async findSessionSubject(userId: string): Promise<SessionSubject | null> {
    const result = await this.pool.query<{
      id: string
      username: string
      email: string
      email_verified: boolean
      status: 'active' | 'banned'
      role: 'user' | 'organizer' | 'admin'
      session_version: string
      must_change_password: boolean
    }>(
      `SELECT u.id, u.username, u.email, (u.email_verified_at IS NOT NULL) AS email_verified,
              u.status::text, r.role::text, u.session_version::text, u.must_change_password
       FROM users u
       JOIN user_roles r ON r.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    )
    const subject = result.rows[0]
    if (!subject) return null
    return {
      userId: subject.id,
      username: subject.username,
      email: subject.email,
      emailVerified: subject.email_verified,
      status: subject.status,
      role: subject.role,
      sessionVersion: Number(subject.session_version),
      mustChangePassword: subject.must_change_password,
    }
  }

  async replacePasswordHash(userId: string, previousHash: string, nextHash: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE credentials
       SET password_hash = $3, password_updated_at = now()
       WHERE user_id = $1 AND password_hash = $2`,
      [userId, previousHash, nextHash],
    )
    return result.rowCount === 1
  }

  async changePassword(
    userId: string,
    previousHash: string,
    nextHash: string,
    changedAt: Date,
  ): Promise<PasswordMutationResult> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const credential = await connection.query(
        `UPDATE credentials
         SET password_hash = $3, password_updated_at = $4
         WHERE user_id = $1 AND password_hash = $2`,
        [userId, previousHash, nextHash, changedAt],
      )
      if (credential.rowCount !== 1) throw new IdentityMutationConflictError()
      const user = await connection.query<{ session_version: string }>(
        `UPDATE users
         SET session_version = session_version + 1,
             must_change_password = false,
             version = version + 1,
             updated_at = $2
         WHERE id = $1
         RETURNING session_version::text`,
        [userId, changedAt],
      )
      if (!user.rows[0]) throw new IdentityMutationConflictError()
      await connection.query(
        `UPDATE email_tokens SET used_at = $2
         WHERE user_id = $1 AND purpose = 'reset_password' AND used_at IS NULL`,
        [userId, changedAt],
      )
      await connection.query('COMMIT')
      return { userId, sessionVersion: Number(user.rows[0].session_version) }
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
  }

  async resetPassword(
    tokenDigest: Buffer,
    nextHash: string,
    consumedAt: Date,
  ): Promise<PasswordMutationResult> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const token = await connection.query<{ id: string, user_id: string }>(
        `SELECT t.id, t.user_id
         FROM email_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.token_digest = $1
           AND t.purpose = 'reset_password'
           AND t.used_at IS NULL
           AND t.expires_at > $2
           AND t.target_email_normalized = u.email_normalized
           AND u.status = 'active'
         FOR UPDATE OF t, u`,
        [tokenDigest, consumedAt],
      )
      const activeToken = token.rows[0]
      if (!activeToken) throw new InvalidEmailTokenError()
      await connection.query(
        `UPDATE credentials SET password_hash = $2, password_updated_at = $3 WHERE user_id = $1`,
        [activeToken.user_id, nextHash, consumedAt],
      )
      const user = await connection.query<{ session_version: string }>(
        `UPDATE users
         SET session_version = session_version + 1,
             must_change_password = false,
             version = version + 1,
             updated_at = $2
         WHERE id = $1
         RETURNING session_version::text`,
        [activeToken.user_id, consumedAt],
      )
      await connection.query(
        `UPDATE email_tokens SET used_at = $2
         WHERE user_id = $1 AND purpose = 'reset_password' AND used_at IS NULL`,
        [activeToken.user_id, consumedAt],
      )
      await connection.query('COMMIT')
      return { userId: activeToken.user_id, sessionVersion: Number(user.rows[0]!.session_version) }
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
  }

  async issueEmailToken(token: NewEmailToken): Promise<void> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      await connection.query(
        `UPDATE email_tokens SET used_at = $3
         WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
        [token.userId, token.purpose, token.issuedAt],
      )
      await connection.query(
        `INSERT INTO email_tokens
           (user_id, purpose, token_digest, target_email_normalized, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          token.userId,
          token.purpose,
          token.tokenDigest,
          token.targetEmailNormalized,
          token.expiresAt,
          token.issuedAt,
        ],
      )
      await connection.query('COMMIT')
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
  }

  async verifyEmail(tokenDigest: Buffer, consumedAt: Date): Promise<PasswordMutationResult> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const token = await connection.query<{ id: string, user_id: string }>(
        `SELECT t.id, t.user_id
         FROM email_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.token_digest = $1
           AND t.purpose = 'verify_email'
           AND t.used_at IS NULL
           AND t.expires_at > $2
           AND t.target_email_normalized = u.email_normalized
           AND u.status = 'active'
         FOR UPDATE OF t, u`,
        [tokenDigest, consumedAt],
      )
      const activeToken = token.rows[0]
      if (!activeToken) throw new InvalidEmailTokenError()
      const user = await connection.query<{ session_version: string }>(
        `UPDATE users
         SET email_verified_at = COALESCE(email_verified_at, $2),
             version = version + 1,
             updated_at = $2
         WHERE id = $1
         RETURNING session_version::text`,
        [activeToken.user_id, consumedAt],
      )
      await connection.query(
        `UPDATE email_tokens SET used_at = $2
         WHERE user_id = $1 AND purpose = 'verify_email' AND used_at IS NULL`,
        [activeToken.user_id, consumedAt],
      )
      await connection.query('COMMIT')
      return { userId: activeToken.user_id, sessionVersion: Number(user.rows[0]!.session_version) }
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
  }
}
