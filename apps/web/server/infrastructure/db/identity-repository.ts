import type { Pool, PoolClient } from 'pg'
import {
  IdentityConflictError,
  IdentityMutationConflictError,
  IdentityNotFoundError,
  InvalidEmailTokenError,
  PublicRegistrationDisabledError,
  type GlobalRole,
  type GlobalRoleMutationResult,
  type ChangeGlobalRoleCommand,
  type ChangeUserStatusCommand,
  type ManagedIdentityPage,
  type ManagedUserStatus,
  type DefaultAdministratorBootstrapResult,
  type IdentityRepository,
  type NewEmailToken,
  type NewIdentity,
  type PasswordMutationResult,
  type PasswordResetRecipient,
  type RegisteredIdentity,
  type SessionSubject,
  type StoredCredential,
  type StoredIdentity,
  type UserStatusMutationResult,
} from '../../domains/identity/repository'

interface PostgresErrorLike {
  code?: unknown
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as PostgresErrorLike).code === '23505'
}

interface SecurityEventInput {
  userId: string
  recipientNormalized: string
  templateKey: string
  dedupeKey: string
  occurredAt: Date
  eventPayload?: Record<string, unknown>
  mailPayload?: Record<string, unknown>
}

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(private readonly pool: Pool) {}

  private async appendSecurityEvent(connection: PoolClient, input: SecurityEventInput): Promise<void> {
    const event = await connection.query<{ id: string }>(
      `INSERT INTO domain_outbox
         (aggregate_type, aggregate_id, event_type, event_version, dedupe_key, payload, occurred_at, available_at)
       VALUES ('user', $1, $2, 1, $3, $4, $5, $5)
       ON CONFLICT (dedupe_key) DO UPDATE SET dedupe_key = EXCLUDED.dedupe_key
       RETURNING id`,
      [input.userId, input.templateKey, input.dedupeKey, input.eventPayload ?? {}, input.occurredAt],
    )
    const eventId = event.rows[0]!.id
    await connection.query(
      `INSERT INTO notifications (user_id, source_event_id, template_key, payload, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, source_event_id) DO NOTHING`,
      [input.userId, eventId, input.templateKey, input.eventPayload ?? {}, input.occurredAt],
    )
    await connection.query(
      `INSERT INTO mail_deliveries
         (source_event_id, recipient, recipient_normalized, template_key, payload, available_at, created_at, updated_at)
       VALUES ($1, $2, $2, $3, $4, $5, $5, $5)
       ON CONFLICT (source_event_id, recipient_normalized, template_key) DO NOTHING`,
      [eventId, input.recipientNormalized, input.templateKey, input.mailPayload ?? input.eventPayload ?? {}, input.occurredAt],
    )
  }

  async createIdentity(identity: NewIdentity): Promise<RegisteredIdentity> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const settings = await connection.query<{ public_registration_enabled: boolean }>(`
        SELECT public_registration_enabled FROM platform_settings
        WHERE singleton = true FOR SHARE`)
      if (settings.rows[0]?.public_registration_enabled !== true) {
        throw new PublicRegistrationDisabledError()
      }
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

  async bootstrapDefaultAdministrator(identity: NewIdentity): Promise<DefaultAdministratorBootstrapResult> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      await connection.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
      const existing = await connection.query('SELECT 1 FROM users LIMIT 1')
      if (existing.rowCount !== 0) {
        await connection.query('COMMIT')
        return { created: false, identity: null }
      }

      const user = await connection.query<{ id: string, session_version: string }>(
        `INSERT INTO users
           (username, username_normalized, email, email_normalized, must_change_password)
         VALUES ($1, $2, $3, $4, true)
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
         VALUES ($1, 'admin')`,
        [created.id],
      )
      await connection.query('COMMIT')
      return {
        created: true,
        identity: { userId: created.id, sessionVersion: Number(created.session_version) },
      }
    }
    catch (error) {
      await connection.query('ROLLBACK')
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
      status: 'active' | 'banned' | 'deleted'
    }>(
      `SELECT u.id, u.username, u.email, c.password_hash, u.session_version::text,
              u.status::text
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
      status: identity.status,
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

  async listManagedIdentities(cursor: string | undefined, limit: number): Promise<ManagedIdentityPage> {
    const result = await this.pool.query<{
      id: string
      username: string
      email: string
      email_verified: boolean
      status: ManagedUserStatus
      role: GlobalRole
      session_version: string
      must_change_password: boolean
      created_at: Date
    }>(
      `SELECT u.id, u.username, u.email, (u.email_verified_at IS NOT NULL) AS email_verified,
              u.status::text, r.role::text, u.session_version::text,
              u.must_change_password, u.created_at
       FROM users u
       JOIN user_roles r ON r.user_id = u.id
       WHERE u.status <> 'deleted'
         AND ($1::uuid IS NULL OR u.id > $1::uuid)
       ORDER BY u.id ASC
       LIMIT $2`,
      [cursor ?? null, limit + 1],
    )
    const hasMore = result.rows.length > limit
    const rows = result.rows.slice(0, limit)
    return {
      items: rows.map(row => ({
        userId: row.id,
        username: row.username,
        email: row.email,
        emailVerified: row.email_verified,
        status: row.status,
        role: row.role,
        sessionVersion: Number(row.session_version),
        mustChangePassword: row.must_change_password,
        createdAt: row.created_at,
      })),
      nextCursor: hasMore ? rows.at(-1)!.id : null,
      hasMore,
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
      const user = await connection.query<{ session_version: string, email_normalized: string }>(
        `UPDATE users
         SET session_version = session_version + 1,
             must_change_password = false,
             version = version + 1,
             updated_at = $2
         WHERE id = $1
         RETURNING session_version::text, email_normalized`,
        [userId, changedAt],
      )
      if (!user.rows[0]) throw new IdentityMutationConflictError()
      await connection.query(
        `UPDATE email_tokens SET used_at = $2
         WHERE user_id = $1 AND purpose = 'reset_password' AND used_at IS NULL`,
        [userId, changedAt],
      )
      await this.appendSecurityEvent(connection, {
        userId,
        recipientNormalized: user.rows[0].email_normalized,
        templateKey: 'identity.password_changed',
        dedupeKey: `identity.password_changed:${userId}:${user.rows[0].session_version}`,
        occurredAt: changedAt,
        eventPayload: { method: 'current_password' },
      })
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
      const token = await connection.query<{ id: string, user_id: string, email_normalized: string }>(
        `SELECT t.id, t.user_id, u.email_normalized
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
      await this.appendSecurityEvent(connection, {
        userId: activeToken.user_id,
        recipientNormalized: activeToken.email_normalized,
        templateKey: 'identity.password_changed',
        dedupeKey: `identity.password_changed:reset:${activeToken.user_id}:${user.rows[0]!.session_version}`,
        occurredAt: consumedAt,
        eventPayload: { method: 'password_reset' },
      })
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
      const templateKey = token.purpose === 'verify_email'
        ? 'identity.email_verification_requested'
        : 'identity.password_reset_requested'
      await this.appendSecurityEvent(connection, {
        userId: token.userId,
        recipientNormalized: token.targetEmailNormalized,
        templateKey,
        dedupeKey: `${templateKey}:${token.tokenDigest.toString('hex')}`,
        occurredAt: token.issuedAt,
        eventPayload: {
          purpose: token.purpose,
          expires_at: token.expiresAt.toISOString(),
        },
        mailPayload: {
          purpose: token.purpose,
          expires_at: token.expiresAt.toISOString(),
          token_envelope: token.tokenEnvelope,
        },
      })
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
      const token = await connection.query<{ id: string, user_id: string, email_normalized: string }>(
        `SELECT t.id, t.user_id, u.email_normalized
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
      await this.appendSecurityEvent(connection, {
        userId: activeToken.user_id,
        recipientNormalized: activeToken.email_normalized,
        templateKey: 'identity.email_verified',
        dedupeKey: `identity.email_verified:${tokenDigest.toString('hex')}`,
        occurredAt: consumedAt,
      })
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

  async changeGlobalRole(command: ChangeGlobalRoleCommand): Promise<GlobalRoleMutationResult> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const current = await connection.query<{
        role: GlobalRole
        session_version: string
        email_normalized: string
      }>(
        `SELECT r.role::text, u.session_version::text, u.email_normalized
         FROM users u
         JOIN user_roles r ON r.user_id = u.id
         WHERE u.id = $1
         FOR UPDATE OF u, r`,
        [command.targetUserId],
      )
      const existing = current.rows[0]
      if (!existing) throw new IdentityNotFoundError()

      if (existing.role === command.role) {
        await connection.query('COMMIT')
        return {
          userId: command.targetUserId,
          previousRole: existing.role,
          role: command.role,
          sessionVersion: Number(existing.session_version),
          changed: false,
        }
      }

      await connection.query(
        `UPDATE user_roles SET role = $2, updated_at = $3 WHERE user_id = $1`,
        [command.targetUserId, command.role, command.changedAt],
      )
      const user = await connection.query<{ session_version: string }>(
        `UPDATE users
         SET session_version = session_version + 1,
             version = version + 1,
             updated_at = $2
         WHERE id = $1
         RETURNING session_version::text`,
        [command.targetUserId, command.changedAt],
      )
      await this.appendSecurityEvent(connection, {
        userId: command.targetUserId,
        recipientNormalized: existing.email_normalized,
        templateKey: 'identity.role_changed',
        dedupeKey: `identity.role_changed:${command.targetUserId}:${user.rows[0]!.session_version}`,
        occurredAt: command.changedAt,
        eventPayload: { previous_role: existing.role, role: command.role },
      })
      await this.appendManagementAudit(connection, {
        actorId: command.actorId,
        action: 'identity.role_changed',
        targetType: 'user_role',
        targetId: command.targetUserId,
        reason: command.reason,
        requestId: command.requestId,
        occurredAt: command.changedAt,
        changes: {
          previous_role: existing.role,
          role: command.role,
          session_version: Number(user.rows[0]!.session_version),
        },
      })
      await connection.query('COMMIT')
      return {
        userId: command.targetUserId,
        previousRole: existing.role,
        role: command.role,
        sessionVersion: Number(user.rows[0]!.session_version),
        changed: true,
      }
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
  }

  async changeUserStatus(command: ChangeUserStatusCommand): Promise<UserStatusMutationResult> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const current = await connection.query<{
        status: ManagedUserStatus
        session_version: string
        email_normalized: string
      }>(
        `SELECT status::text, session_version::text, email_normalized
         FROM users
         WHERE id = $1 AND status <> 'deleted'
         FOR UPDATE`,
        [command.targetUserId],
      )
      const existing = current.rows[0]
      if (!existing) throw new IdentityNotFoundError()
      if (existing.status === command.status) {
        await connection.query('COMMIT')
        return {
          userId: command.targetUserId,
          previousStatus: existing.status,
          status: command.status,
          sessionVersion: Number(existing.session_version),
          changed: false,
        }
      }

      const user = await connection.query<{ session_version: string }>(
        `UPDATE users
         SET status = $2,
             session_version = session_version + 1,
             version = version + 1,
             updated_at = $3
         WHERE id = $1
         RETURNING session_version::text`,
        [command.targetUserId, command.status, command.changedAt],
      )
      await this.appendSecurityEvent(connection, {
        userId: command.targetUserId,
        recipientNormalized: existing.email_normalized,
        templateKey: command.status === 'banned' ? 'identity.account_banned' : 'identity.account_reactivated',
        dedupeKey: `identity.account_status_changed:${command.targetUserId}:${user.rows[0]!.session_version}`,
        occurredAt: command.changedAt,
        eventPayload: { previous_status: existing.status, status: command.status },
      })
      await this.appendManagementAudit(connection, {
        actorId: command.actorId,
        action: 'identity.status_changed',
        targetType: 'user',
        targetId: command.targetUserId,
        reason: command.reason,
        requestId: command.requestId,
        occurredAt: command.changedAt,
        changes: {
          previous_status: existing.status,
          status: command.status,
          session_version: Number(user.rows[0]!.session_version),
        },
      })
      await connection.query('COMMIT')
      return {
        userId: command.targetUserId,
        previousStatus: existing.status,
        status: command.status,
        sessionVersion: Number(user.rows[0]!.session_version),
        changed: true,
      }
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
  }

  private async appendManagementAudit(connection: PoolClient, input: {
    actorId: string
    action: string
    targetType: string
    targetId: string
    reason: string
    requestId: string
    changes: Record<string, unknown>
    occurredAt: Date
  }) {
    await connection.query(`
      INSERT INTO audit_events
        (actor_user_id, action, target_type, target_id, reason,
         outcome, request_id, changes, metadata, occurred_at)
      VALUES ($1, $2, $3, $4, $5, 'succeeded', $6, $7, '{}'::jsonb, $8)`, [
      input.actorId,
      input.action,
      input.targetType,
      input.targetId,
      input.reason,
      input.requestId,
      input.changes,
      input.occurredAt,
    ])
  }

  async changeEmail(
    userId: string,
    email: string,
    emailNormalized: string,
    changedAt: Date,
  ): Promise<PasswordMutationResult> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const user = await connection.query<{ session_version: string }>(
        `UPDATE users
         SET email = $2,
             email_normalized = $3,
             email_verified_at = NULL,
             session_version = session_version + 1,
             version = version + 1,
             updated_at = $4
         WHERE id = $1
         RETURNING session_version::text`,
        [userId, email, emailNormalized, changedAt],
      )
      if (!user.rows[0]) throw new IdentityNotFoundError()
      await connection.query(
        `UPDATE email_tokens SET used_at = $2 WHERE user_id = $1 AND used_at IS NULL`,
        [userId, changedAt],
      )
      await this.appendSecurityEvent(connection, {
        userId,
        recipientNormalized: emailNormalized,
        templateKey: 'identity.email_changed',
        dedupeKey: `identity.email_changed:${userId}:${user.rows[0].session_version}`,
        occurredAt: changedAt,
      })
      await connection.query('COMMIT')
      return { userId, sessionVersion: Number(user.rows[0].session_version) }
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
}
