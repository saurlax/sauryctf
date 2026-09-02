import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { PostgresTestClient as Client } from '../../test-support/postgres-database'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AesGcmIdentityMailTokenProtector } from '../../infrastructure/auth/identity-mail-token-protector'
import { identityTokenCodec } from '../../infrastructure/auth/identity-token-codec'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { PostgresIdentityRepository } from '../../infrastructure/db/identity-repository'
import { runPostgresTestMigrations } from '../../test-support/postgres-database'
import { PostgresMailOutboxRepository } from '../../infrastructure/mail/postgres-mail-outbox'
import type { PasswordHasher } from '../identity/password'
import { IdentityService } from '../identity/service'
import { MailOutboxDispatcher } from './mail-outbox'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName(): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected test database name')
  return `"${databaseName}"`
}

class TestHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return `$scrypt$test$${scryptSync(password, 'mail-outbox-test', 32).toString('hex')}`
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    const expectedHex = passwordHash.split('$')[3]
    if (!expectedHex) return false
    const expected = Buffer.from(expectedHex, 'hex')
    const actual = scryptSync(password, 'mail-outbox-test', expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }

  needsRehash(): boolean { return false }
}

describeWithPostgres('security mail outbox dispatcher', () => {
  let admin: Client
  let database: PostgresTestDatabase
  let service: IdentityService
  let currentTime = new Date('2026-09-01T08:00:00.000Z')

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createPostgresTestDatabase({ connectionString: url.toString(), maxConnections: 4 })
    await runPostgresTestMigrations(database)
    service = new IdentityService(
      new PostgresIdentityRepository(database.executor),
      new TestHasher(),
      identityTokenCodec,
      () => new Date(currentTime),
      new AesGcmIdentityMailTokenProtector('mail-outbox-test-secret-that-is-at-least-32-characters'),
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

  it('keeps the password fact committed across mail failure and retries idempotently after recovery', async () => {
    const registered = await service.register({
      username: 'MailFailureUser',
      email: 'mail-failure@example.test',
      password: 'old password',
    })
    const changed = await service.changePassword(registered.userId, 'old password', 'new password')
    expect(changed.sessionVersion).toBe(2)

    let mailAvailable = false
    const sentMessages: Array<{ messageId: string, templateKey: string }> = []
    const send = vi.fn(async (message: { messageId: string, templateKey: string }) => {
      sentMessages.push({ messageId: message.messageId, templateKey: message.templateKey })
      if (!mailAvailable) throw new Error('mail transport unavailable with sensitive details')
    })
    const dispatcher = new MailOutboxDispatcher(
      'mail-test-worker',
      new PostgresMailOutboxRepository(database.executor),
      { send },
      () => new Date(currentTime),
    )

    await expect(dispatcher.runOnce()).resolves.toBe(1)
    const retrying = await database.executor.query<{
      status: string
      attempt_count: number
      last_error: string
      notification_count: number
    }>(
      `SELECT delivery.status::text, delivery.attempt_count, delivery.last_error,
              (SELECT count(*)::int FROM notifications WHERE user_id = $1) AS notification_count
       FROM mail_deliveries delivery
       WHERE delivery.template_key = 'identity.password_changed'`,
      [registered.userId],
    )
    expect(retrying.rows).toEqual([{
      status: 'retry_wait',
      attempt_count: 1,
      last_error: 'Error',
      notification_count: 1,
    }])
    expect(JSON.stringify(retrying.rows)).not.toContain('sensitive details')
    await expect(service.login({ identifier: 'MailFailureUser', password: 'new password' }))
      .resolves.toMatchObject({ sessionVersion: 2 })

    currentTime = new Date(currentTime.getTime() + 999)
    await expect(dispatcher.runOnce()).resolves.toBe(0)
    currentTime = new Date(currentTime.getTime() + 1)
    mailAvailable = true
    await expect(dispatcher.runOnce()).resolves.toBe(1)
    await expect(dispatcher.runOnce()).resolves.toBe(0)

    const sent = await database.executor.query<{ status: string, attempt_count: number }>(
      `SELECT status::text, attempt_count FROM mail_deliveries
       WHERE template_key = 'identity.password_changed'`,
    )
    expect(sent.rows).toEqual([{ status: 'sent', attempt_count: 2 }])
    expect(send).toHaveBeenCalledTimes(2)
    expect(new Set(sentMessages.map(message => message.messageId)).size).toBe(1)
  })

  it('keeps a reset token usable while its email is retrying and sends it after recovery', async () => {
    await service.register({
      username: 'ResetMailFailure',
      email: 'reset-mail-failure@example.test',
      password: 'before reset',
    })
    const resetRequest = await service.requestPasswordReset('reset-mail-failure@example.test')
    expect(resetRequest.delivery?.token).toBeTruthy()

    let mailAvailable = false
    const sentMessages: Array<{ messageId: string, templateKey: string }> = []
    const send = vi.fn(async (message: { messageId: string, templateKey: string }) => {
      sentMessages.push({ messageId: message.messageId, templateKey: message.templateKey })
      if (!mailAvailable) throw new Error('smtp unavailable')
    })
    const dispatcher = new MailOutboxDispatcher(
      'reset-mail-test-worker',
      new PostgresMailOutboxRepository(database.executor),
      { send },
      () => new Date(currentTime),
    )

    await expect(dispatcher.runOnce()).resolves.toBe(1)
    await expect(service.resetPassword(resetRequest.delivery!.token, 'after reset'))
      .resolves.toMatchObject({ sessionVersion: 2 })
    await expect(service.login({ identifier: 'ResetMailFailure', password: 'after reset' }))
      .resolves.toBeTruthy()

    currentTime = new Date(currentTime.getTime() + 1_000)
    mailAvailable = true
    await expect(dispatcher.runOnce()).resolves.toBe(2)
    await expect(dispatcher.runOnce()).resolves.toBe(0)

    const deliveries = await database.executor.query<{
      template_key: string
      status: string
      attempt_count: number
    }>(
      `SELECT template_key, status::text, attempt_count
       FROM mail_deliveries
       WHERE recipient_normalized = 'reset-mail-failure@example.test'
       ORDER BY template_key`,
    )
    expect(deliveries.rows).toEqual([
      { template_key: 'identity.password_changed', status: 'sent', attempt_count: 1 },
      { template_key: 'identity.password_reset_requested', status: 'sent', attempt_count: 2 },
    ])
    expect(send).toHaveBeenCalledTimes(3)
    const resetMessageIds = sentMessages
      .filter(message => message.templateKey === 'identity.password_reset_requested')
      .map(message => message.messageId)
    expect(resetMessageIds).toHaveLength(2)
    expect(new Set(resetMessageIds).size).toBe(1)
  })
})
