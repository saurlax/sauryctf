import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { PostgresTestClient as Client } from '../../test-support/postgres-database'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { structuredLog } from '../../infrastructure/telemetry/logging'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { PostgresIdentityRepository } from '../../infrastructure/db/identity-repository'
import { runPostgresTestMigrations } from '../../test-support/postgres-database'
import { identityTokenCodec } from '../../infrastructure/auth/identity-token-codec'
import { AesGcmIdentityMailTokenProtector } from '../../infrastructure/auth/identity-mail-token-protector'
import type { PasswordHasher } from './password'
import { IdentityService } from './service'
import { IdentitySessionService } from './session'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName(): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected test database name')
  return `"${databaseName}"`
}

class TestScryptHasher implements PasswordHasher {
  constructor(private currentParameters = 'current') {}

  async hash(password: string): Promise<string> {
    const digest = scryptSync(password, `sauryctf-test-${this.currentParameters}`, 32).toString('hex')
    return `$scrypt$${this.currentParameters}$${digest}`
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    const [, algorithm, parameters, expectedHex] = passwordHash.split('$')
    if (algorithm !== 'scrypt' || !parameters || !expectedHex) return false
    const expected = Buffer.from(expectedHex, 'hex')
    const actual = scryptSync(password, `sauryctf-test-${parameters}`, expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }

  needsRehash(passwordHash: string): boolean {
    return !passwordHash.startsWith(`$scrypt$${this.currentParameters}$`)
  }
}

describeWithPostgres('scrypt identity registration and login', () => {
  let admin: Client
  let database: PostgresTestDatabase
  let repository: PostgresIdentityRepository
  let service: IdentityService
  let hasher: TestScryptHasher
  let currentTime: Date

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createPostgresTestDatabase({ connectionString: url.toString(), maxConnections: 4 })
    await runPostgresTestMigrations(database)
    hasher = new TestScryptHasher()
    currentTime = new Date('2026-09-01T08:00:00.000Z')
    repository = new PostgresIdentityRepository(database.executor)
    service = new IdentityService(
      repository,
      hasher,
      identityTokenCodec,
      () => new Date(currentTime),
      new AesGcmIdentityMailTokenProtector('identity-service-test-secret-that-is-at-least-32-characters'),
    )
  })

  afterAll(async () => {
    if (database) await database.close()
    if (admin) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [databaseName],
      )
      await admin.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName()}`)
      await admin.end()
    }
  })

  it('registers one user, scrypt credential, and default role atomically', async () => {
    const registered = await service.register({
      username: 'PlayerOne',
      email: 'PLAYER.ONE@example.test',
      password: 'correct horse battery staple',
    })
    expect(registered.sessionVersion).toBe(1)

    const rows = await database.executor.query<{
      username_normalized: string
      email_normalized: string
      algorithm: string
      role: string
    }>(
      `SELECT u.username_normalized, u.email_normalized, c.algorithm, r.role::text
       FROM users u
       JOIN credentials c ON c.user_id = u.id
       JOIN user_roles r ON r.user_id = u.id
       WHERE u.id = $1`,
      [registered.userId],
    )
    expect(rows.rows).toEqual([{
      username_normalized: 'playerone',
      email_normalized: 'player.one@example.test',
      algorithm: 'scrypt',
      role: 'user',
    }])
  })

  it('accepts the correct password and rejects a wrong password generically', async () => {
    const login = await service.login({ identifier: 'PLAYERONE', password: 'correct horse battery staple' })
    expect(login.sessionVersion).toBe(1)

    await expect(service.login({ identifier: 'playerone', password: 'wrong password' }))
      .rejects.toMatchObject({ code: 'identity.invalid_credentials' })
    await expect(service.login({ identifier: 'missing', password: 'wrong password' }))
      .rejects.toMatchObject({ code: 'identity.invalid_credentials' })
  })

  it('upgrades an old scrypt parameter set after successful verification', async () => {
    const oldHasher = new TestScryptHasher('old')
    const password = 'upgrade this credential'
    const registered = await new IdentityService(
      new PostgresIdentityRepository(database.executor),
      oldHasher,
    ).register({
      username: 'UpgradeUser',
      email: 'upgrade@example.test',
      password,
    })

    const result = await service.login({ identifier: 'upgrade@example.test', password })
    expect(result.passwordHashUpgraded).toBe(true)
    const credential = await database.executor.query<{ password_hash: string }>(
      'SELECT password_hash FROM credentials WHERE user_id = $1',
      [registered.userId],
    )
    expect(credential.rows[0]!.password_hash).toMatch(/^\$scrypt\$current\$/u)
  })

  it('does not expose passwords or hashes through errors and structured logs', async () => {
    const password = 'never-log-this-password'
    let error: unknown
    try {
      await service.login({ identifier: 'missing', password })
    }
    catch (caught) {
      error = caught
    }
    const log = structuredLog('warn', 'identity.login_failed', {
      identifier: 'missing',
      password,
      error,
    })
    expect(log).not.toContain(password)
    expect(log).not.toContain('$scrypt$')
  })

  it('re-reads status and session version for every protected identity lookup', async () => {
    const repository = new PostgresIdentityRepository(database.executor)
    const registered = await service.register({
      username: 'SessionUser',
      email: 'session-user@example.test',
      password: 'protect this session',
    })
    const sessions = new IdentitySessionService(repository)
    const cookie = {
      user_id: registered.userId,
      session_version: registered.sessionVersion,
      logged_in_at: '2026-09-01T07:08:09.123Z' as const,
    }

    await expect(sessions.validate(cookie)).resolves.toMatchObject({ status: 'active', role: 'user' })
    await database.executor.query(`UPDATE users SET status = 'banned' WHERE id = $1`, [registered.userId])
    await expect(sessions.validate(cookie)).rejects.toMatchObject({ name: 'InvalidIdentitySessionError' })
    await database.executor.query(
      `UPDATE users SET status = 'active', session_version = session_version + 1 WHERE id = $1`,
      [registered.userId],
    )
    await expect(sessions.validate(cookie)).rejects.toMatchObject({ name: 'InvalidIdentitySessionError' })
    await database.executor.query('DELETE FROM users WHERE id = $1', [registered.userId])
    await expect(sessions.validate(cookie)).rejects.toMatchObject({ name: 'InvalidIdentitySessionError' })
  })

  it('changes a password atomically and invalidates every old session version', async () => {
    const registered = await service.register({
      username: 'PasswordUser',
      email: 'password-user@example.test',
      password: 'old password value',
    })
    const result = await service.changePassword(
      registered.userId,
      'old password value',
      'new password value',
    )
    expect(result.sessionVersion).toBe(registered.sessionVersion + 1)

    const sessions = new IdentitySessionService(new PostgresIdentityRepository(database.executor))
    await expect(sessions.validate({
      user_id: registered.userId,
      session_version: registered.sessionVersion,
      logged_in_at: '2026-09-01T07:08:09.123Z',
    })).rejects.toMatchObject({ name: 'InvalidIdentitySessionError' })
    await expect(service.login({ identifier: 'PasswordUser', password: 'old password value' }))
      .rejects.toMatchObject({ code: 'identity.invalid_credentials' })
    await expect(service.login({ identifier: 'PasswordUser', password: 'new password value' }))
      .resolves.toMatchObject({ sessionVersion: result.sessionVersion })
  })

  it('enforces admin-only role changes and invalidates the target user sessions', async () => {
    const registered = await service.register({
      username: 'RoleTarget',
      email: 'role-target@example.test',
      password: 'role target password',
    })
    const userActor = {
      userId: '018f47a2-4ef8-7e2c-9c24-6d68b7451a10',
      username: 'OrdinaryActor',
      email: 'ordinary-actor@example.test',
      emailVerified: true,
      status: 'active' as const,
      role: 'user' as const,
      sessionVersion: 1,
      mustChangePassword: false,
    }
    await expect(service.changeGlobalRole(userActor, {
      targetUserId: registered.userId,
      role: 'organizer',
      reason: 'Unauthorized role attempt',
      requestId: randomUUID(),
    }))
      .rejects.toMatchObject({ code: 'identity.capability_forbidden' })

    const before = await database.executor.query<{ role: string, session_version: string }>(
      `SELECT r.role::text, u.session_version::text
       FROM users u JOIN user_roles r ON r.user_id = u.id WHERE u.id = $1`,
      [registered.userId],
    )
    expect(before.rows).toEqual([{ role: 'user', session_version: '1' }])

    const actorRegistration = await service.register({
      username: 'RoleAdministrator',
      email: 'role-administrator@example.test',
      password: 'role administrator password',
    })
    await database.executor.query(
      `UPDATE users SET email_verified_at = $2 WHERE id = $1`,
      [actorRegistration.userId, currentTime],
    )
    await database.executor.query(
      `UPDATE user_roles SET role = 'admin', updated_at = $2 WHERE user_id = $1`,
      [actorRegistration.userId, currentTime],
    )
    const administrator = await repository.findSessionSubject(actorRegistration.userId)
    expect(administrator).not.toBeNull()
    await expect(service.changeGlobalRole(administrator!, {
      targetUserId: registered.userId,
      role: 'organizer',
      reason: '  ',
      requestId: randomUUID(),
    })).rejects.toMatchObject({ code: 'identity.management_reason_required' })

    const requestId = randomUUID()
    const result = await service.changeGlobalRole(administrator!, {
      targetUserId: registered.userId,
      role: 'organizer',
      reason: '  Assign contest operations  ',
      requestId,
    })
    expect(result).toEqual({
      userId: registered.userId,
      previousRole: 'user',
      role: 'organizer',
      sessionVersion: 2,
      changed: true,
    })
    const securityRecords = await database.executor.query<{
      event_count: string
      notification_count: string
      delivery_count: string
      audit_count: string
    }>(
      `SELECT
         (SELECT count(*)::text FROM domain_outbox
          WHERE aggregate_id = $1 AND event_type = 'identity.role_changed') AS event_count,
         (SELECT count(*)::text FROM notifications
          WHERE user_id = $1 AND template_key = 'identity.role_changed') AS notification_count,
         (SELECT count(*)::text FROM mail_deliveries
          WHERE recipient_normalized = 'role-target@example.test'
            AND template_key = 'identity.role_changed') AS delivery_count,
         (SELECT count(*)::text FROM audit_events
          WHERE actor_user_id = $2
            AND request_id = $3
            AND action = 'identity.role_changed'
            AND target_type = 'user_role'
            AND target_id = $1
            AND reason = 'Assign contest operations'
            AND outcome = 'succeeded'
            AND changes = jsonb_build_object(
              'previous_role', 'user',
              'role', 'organizer',
              'session_version', 2
            )
            AND occurred_at = $4) AS audit_count`,
      [registered.userId, administrator!.userId, requestId, currentTime],
    )
    expect(securityRecords.rows).toEqual([{
      event_count: '1',
      notification_count: '1',
      delivery_count: '1',
      audit_count: '1',
    }])

    const sessions = new IdentitySessionService(new PostgresIdentityRepository(database.executor))
    await expect(sessions.validate({
      user_id: registered.userId,
      session_version: registered.sessionVersion,
      logged_in_at: '2026-09-01T07:08:09.123Z',
    })).rejects.toMatchObject({ name: 'InvalidIdentitySessionError' })
    await expect(sessions.validate({
      user_id: registered.userId,
      session_version: result.sessionVersion,
      logged_in_at: '2026-09-01T07:08:09.123Z',
    })).resolves.toMatchObject({ role: 'organizer' })

    await expect(service.changeGlobalRole(administrator!, {
      targetUserId: registered.userId,
      role: 'organizer',
      reason: 'Confirm existing role assignment',
      requestId: randomUUID(),
    })).resolves.toMatchObject({ sessionVersion: 2, changed: false })
  })

  it('audits account status changes with their security notifications in one transaction', async () => {
    const target = await service.register({
      username: 'StatusTarget',
      email: 'status-target@example.test',
      password: 'status target password',
    })
    const actor = await service.register({
      username: 'StatusAdministrator',
      email: 'status-administrator@example.test',
      password: 'status administrator password',
    })
    await database.executor.query(
      `UPDATE users SET email_verified_at = $2 WHERE id = $1`,
      [actor.userId, currentTime],
    )
    await database.executor.query(
      `UPDATE user_roles SET role = 'admin', updated_at = $2 WHERE user_id = $1`,
      [actor.userId, currentTime],
    )
    const administrator = await repository.findSessionSubject(actor.userId)
    expect(administrator).not.toBeNull()
    const requestId = randomUUID()

    const result = await service.changeUserStatus(administrator!, {
      targetUserId: target.userId,
      status: 'banned',
      reason: '  Confirmed account abuse  ',
      requestId,
    })

    expect(result).toMatchObject({
      userId: target.userId,
      previousStatus: 'active',
      status: 'banned',
      sessionVersion: 2,
      changed: true,
    })
    const evidence = await database.executor.query<{
      event_count: string
      notification_count: string
      delivery_count: string
      audit_count: string
    }>(`
      SELECT
        (SELECT count(*)::text FROM domain_outbox
         WHERE aggregate_id = $1 AND event_type = 'identity.account_banned') AS event_count,
        (SELECT count(*)::text FROM notifications
         WHERE user_id = $1 AND template_key = 'identity.account_banned') AS notification_count,
        (SELECT count(*)::text FROM mail_deliveries
         WHERE recipient_normalized = 'status-target@example.test'
           AND template_key = 'identity.account_banned') AS delivery_count,
        (SELECT count(*)::text FROM audit_events
         WHERE actor_user_id = $2
           AND request_id = $3
           AND action = 'identity.status_changed'
           AND target_type = 'user'
           AND target_id = $1
           AND reason = 'Confirmed account abuse'
           AND outcome = 'succeeded'
           AND changes = jsonb_build_object(
             'previous_status', 'active',
             'status', 'banned',
             'session_version', 2
           )
           AND occurred_at = $4) AS audit_count`,
    [target.userId, administrator!.userId, requestId, currentTime])
    expect(evidence.rows).toEqual([{
      event_count: '1',
      notification_count: '1',
      delivery_count: '1',
      audit_count: '1',
    }])
  })

  it('rolls back role, status, session, and notifications when a management audit cannot append', async () => {
    const actor = await service.register({
      username: 'RollbackAdministrator',
      email: 'rollback-administrator@example.test',
      password: 'rollback administrator password',
    })
    const roleTarget = await service.register({
      username: 'RoleRollbackTarget',
      email: 'role-rollback-target@example.test',
      password: 'role rollback target password',
    })
    const statusTarget = await service.register({
      username: 'StatusRollbackTarget',
      email: 'status-rollback-target@example.test',
      password: 'status rollback target password',
    })
    await database.executor.query(
      `UPDATE users SET email_verified_at = $2 WHERE id = $1`,
      [actor.userId, currentTime],
    )
    await database.executor.query(
      `UPDATE user_roles SET role = 'admin', updated_at = $2 WHERE user_id = $1`,
      [actor.userId, currentTime],
    )
    const administrator = await repository.findSessionSubject(actor.userId)
    expect(administrator).not.toBeNull()
    const roleRequestId = randomUUID()
    const statusRequestId = randomUUID()
    await database.executor.query(
      `INSERT INTO audit_events
        (actor_user_id, action, target_type, target_id, reason, outcome, request_id)
       VALUES
        ($1, 'identity.role_changed', 'user_role', $2, 'Existing role audit', 'succeeded', $3),
        ($1, 'identity.status_changed', 'user', $4, 'Existing status audit', 'succeeded', $5)`,
      [actor.userId, roleTarget.userId, roleRequestId, statusTarget.userId, statusRequestId],
    )

    await expect(service.changeGlobalRole(administrator!, {
      targetUserId: roleTarget.userId,
      role: 'organizer',
      reason: 'Trigger duplicate role audit',
      requestId: roleRequestId,
    })).rejects.toMatchObject({ code: '23505' })
    await expect(service.changeUserStatus(administrator!, {
      targetUserId: statusTarget.userId,
      status: 'banned',
      reason: 'Trigger duplicate status audit',
      requestId: statusRequestId,
    })).rejects.toMatchObject({ code: '23505' })

    const facts = await database.executor.query<{
      role: string
      role_session_version: string
      status: string
      status_session_version: string
      security_events: string
      notifications: string
      deliveries: string
      audits: string
    }>(`
      SELECT
        (SELECT role::text FROM user_roles WHERE user_id = $1) AS role,
        (SELECT session_version::text FROM users WHERE id = $1) AS role_session_version,
        (SELECT status::text FROM users WHERE id = $2) AS status,
        (SELECT session_version::text FROM users WHERE id = $2) AS status_session_version,
        (SELECT count(*)::text FROM domain_outbox
         WHERE aggregate_id IN ($1, $2)
           AND event_type IN ('identity.role_changed', 'identity.account_banned')) AS security_events,
        (SELECT count(*)::text FROM notifications
         WHERE user_id IN ($1, $2)
           AND template_key IN ('identity.role_changed', 'identity.account_banned')) AS notifications,
        (SELECT count(*)::text FROM mail_deliveries
         WHERE recipient_normalized IN (
           'role-rollback-target@example.test',
           'status-rollback-target@example.test'
         ) AND template_key IN ('identity.role_changed', 'identity.account_banned')) AS deliveries,
        (SELECT count(*)::text FROM audit_events
         WHERE request_id IN ($3, $4)) AS audits`,
    [roleTarget.userId, statusTarget.userId, roleRequestId, statusRequestId])
    expect(facts.rows).toEqual([{
      role: 'user',
      role_session_version: '1',
      status: 'active',
      status_session_version: '1',
      security_events: '0',
      notifications: '0',
      deliveries: '0',
      audits: '2',
    }])
  })

  it('does not mutate the credential or session version for a wrong current password', async () => {
    const registered = await service.register({
      username: 'WrongCurrent',
      email: 'wrong-current@example.test',
      password: 'correct current password',
    })
    await expect(service.changePassword(registered.userId, 'incorrect', 'replacement'))
      .rejects.toMatchObject({ code: 'identity.invalid_credentials' })
    await expect(service.login({ identifier: 'WrongCurrent', password: 'correct current password' }))
      .resolves.toMatchObject({ sessionVersion: registered.sessionVersion })
  })

  it('issues only a reset digest, returns the same public acceptance shape, and consumes once', async () => {
    const registered = await service.register({
      username: 'ResetUser',
      email: 'reset-user@example.test',
      password: 'before reset password',
    })
    const existing = await service.requestPasswordReset('RESET-USER@example.test')
    const missing = await service.requestPasswordReset('missing@example.test')
    expect(existing.accepted).toBe(true)
    expect(missing).toEqual({ accepted: true, delivery: null })
    expect(existing.delivery?.token).toBeTruthy()

    const stored = await database.executor.query<{ token_digest: Buffer }>(
      `SELECT token_digest FROM email_tokens WHERE user_id = $1 AND purpose = 'reset_password'`,
      [registered.userId],
    )
    expect(stored.rows[0]!.token_digest).toEqual(identityTokenCodec.digest(existing.delivery!.token))
    expect(stored.rows[0]!.token_digest.toString('utf8')).not.toContain(existing.delivery!.token)
    const queuedMail = await database.executor.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM mail_deliveries
       WHERE template_key = 'identity.password_reset_requested'
       ORDER BY created_at DESC LIMIT 1`,
    )
    expect(JSON.stringify(queuedMail.rows[0]!.payload)).not.toContain(existing.delivery!.token)

    const reset = await service.resetPassword(existing.delivery!.token, 'after reset password')
    expect(reset.sessionVersion).toBe(registered.sessionVersion + 1)
    await expect(service.resetPassword(existing.delivery!.token, 'another password'))
      .rejects.toMatchObject({ code: 'identity.token_invalid' })
    await expect(service.login({ identifier: 'ResetUser', password: 'after reset password' }))
      .resolves.toMatchObject({ sessionVersion: reset.sessionVersion })
  })

  it('rejects expired reset tokens without changing the password', async () => {
    await service.register({
      username: 'ExpiredReset',
      email: 'expired-reset@example.test',
      password: 'original password',
    })
    const request = await service.requestPasswordReset('expired-reset@example.test', 1_000)
    currentTime = new Date(currentTime.getTime() + 1_001)
    await expect(service.resetPassword(request.delivery!.token, 'should not apply'))
      .rejects.toMatchObject({ code: 'identity.token_invalid' })
    await expect(service.login({ identifier: 'ExpiredReset', password: 'original password' }))
      .resolves.toBeTruthy()
  })

  it('rotates email verification tokens and verifies the current email exactly once', async () => {
    const registered = await service.register({
      username: 'VerifyUser',
      email: 'verify-user@example.test',
      password: 'verification password',
    })
    const first = await service.requestEmailVerification(registered.userId)
    const second = await service.requestEmailVerification(registered.userId)
    await expect(service.verifyEmail(first.token)).rejects.toMatchObject({ code: 'identity.token_invalid' })
    await expect(service.verifyEmail(second.token)).resolves.toMatchObject({ userId: registered.userId })
    await expect(service.verifyEmail(second.token)).rejects.toMatchObject({ code: 'identity.token_invalid' })

    const subject = await new PostgresIdentityRepository(database.executor).findSessionSubject(registered.userId)
    expect(subject?.emailVerified).toBe(true)
  })
})
