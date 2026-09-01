import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { structuredLog } from '../../infrastructure/telemetry/logging'
import { createDatabaseClient, type DatabaseClient } from '../../infrastructure/db/client'
import { PostgresIdentityRepository } from '../../infrastructure/db/identity-repository'
import { runMigrations } from '../../infrastructure/db/migrate'
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
  let database: DatabaseClient
  let service: IdentityService
  let hasher: TestScryptHasher
  let currentTime: Date

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 4 })
    await runMigrations(database)
    hasher = new TestScryptHasher()
    currentTime = new Date('2026-09-01T08:00:00.000Z')
    service = new IdentityService(
      new PostgresIdentityRepository(database.pool),
      hasher,
      identityTokenCodec,
      () => new Date(currentTime),
      new AesGcmIdentityMailTokenProtector('identity-service-test-secret-that-is-at-least-32-characters'),
    )
  })

  afterAll(async () => {
    if (database) await database.pool.end()
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

    const rows = await database.pool.query<{
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
      new PostgresIdentityRepository(database.pool),
      oldHasher,
    ).register({
      username: 'UpgradeUser',
      email: 'upgrade@example.test',
      password,
    })

    const result = await service.login({ identifier: 'upgrade@example.test', password })
    expect(result.passwordHashUpgraded).toBe(true)
    const credential = await database.pool.query<{ password_hash: string }>(
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
    const repository = new PostgresIdentityRepository(database.pool)
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
    await database.pool.query(`UPDATE users SET status = 'banned' WHERE id = $1`, [registered.userId])
    await expect(sessions.validate(cookie)).rejects.toMatchObject({ name: 'InvalidIdentitySessionError' })
    await database.pool.query(
      `UPDATE users SET status = 'active', session_version = session_version + 1 WHERE id = $1`,
      [registered.userId],
    )
    await expect(sessions.validate(cookie)).rejects.toMatchObject({ name: 'InvalidIdentitySessionError' })
    await database.pool.query('DELETE FROM users WHERE id = $1', [registered.userId])
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

    const sessions = new IdentitySessionService(new PostgresIdentityRepository(database.pool))
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
    await expect(service.changeGlobalRole(userActor, registered.userId, 'organizer'))
      .rejects.toMatchObject({ code: 'identity.capability_forbidden' })

    const before = await database.pool.query<{ role: string, session_version: string }>(
      `SELECT r.role::text, u.session_version::text
       FROM users u JOIN user_roles r ON r.user_id = u.id WHERE u.id = $1`,
      [registered.userId],
    )
    expect(before.rows).toEqual([{ role: 'user', session_version: '1' }])

    const result = await service.changeGlobalRole(
      { ...userActor, role: 'admin' },
      registered.userId,
      'organizer',
    )
    expect(result).toEqual({
      userId: registered.userId,
      previousRole: 'user',
      role: 'organizer',
      sessionVersion: 2,
      changed: true,
    })
    const securityRecords = await database.pool.query<{
      event_count: string
      notification_count: string
      delivery_count: string
    }>(
      `SELECT
         (SELECT count(*)::text FROM domain_outbox
          WHERE aggregate_id = $1 AND event_type = 'identity.role_changed') AS event_count,
         (SELECT count(*)::text FROM notifications
          WHERE user_id = $1 AND template_key = 'identity.role_changed') AS notification_count,
         (SELECT count(*)::text FROM mail_deliveries
          WHERE recipient_normalized = 'role-target@example.test'
            AND template_key = 'identity.role_changed') AS delivery_count`,
      [registered.userId],
    )
    expect(securityRecords.rows).toEqual([{
      event_count: '1',
      notification_count: '1',
      delivery_count: '1',
    }])

    const sessions = new IdentitySessionService(new PostgresIdentityRepository(database.pool))
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

    await expect(service.changeGlobalRole(
      { ...userActor, role: 'admin' },
      registered.userId,
      'organizer',
    )).resolves.toMatchObject({ sessionVersion: 2, changed: false })
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

    const stored = await database.pool.query<{ token_digest: Buffer }>(
      `SELECT token_digest FROM email_tokens WHERE user_id = $1 AND purpose = 'reset_password'`,
      [registered.userId],
    )
    expect(stored.rows[0]!.token_digest).toEqual(identityTokenCodec.digest(existing.delivery!.token))
    expect(stored.rows[0]!.token_digest.toString('utf8')).not.toContain(existing.delivery!.token)
    const queuedMail = await database.pool.query<{ payload: Record<string, unknown> }>(
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

    const subject = await new PostgresIdentityRepository(database.pool).findSessionSubject(registered.userId)
    expect(subject?.emailVerified).toBe(true)
  })
})
