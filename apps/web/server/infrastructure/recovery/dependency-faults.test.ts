import { createHash, randomUUID } from 'node:crypto'
import { PostgresTestClient as Client } from '../../test-support/postgres-database'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ContentObjectService } from '../../domains/content/service'
import { MailOutboxDispatcher } from '../../domains/notifications/mail-outbox'
import { AesGcmIdentityMailTokenProtector } from '../auth/identity-mail-token-protector'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { PostgresContentObjectRepository } from '../db/content-object-repository'
import { runPostgresTestMigrations } from '../../test-support/postgres-database'
import { PostgresMailOutboxRepository } from '../mail/postgres-mail-outbox'
import { SmtpMailTransport } from '../mail/smtp-mail-transport'
import {
  S3ContentObjectStore,
  type S3ContentObjectStoreConfig,
} from '../storage/s3-content-object-store'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const s3Endpoint = process.env.TEST_S3_ENDPOINT
const smtpHost = process.env.TEST_SMTP_HOST
const smtpPort = Number.parseInt(process.env.TEST_SMTP_PORT ?? '', 10)
const mailpitApiUrl = process.env.TEST_MAILPIT_API_URL
const describeFaultDrill = adminConnectionString && s3Endpoint && smtpHost
  && Number.isSafeInteger(smtpPort) && smtpPort > 0 && mailpitApiUrl
  ? describe
  : describe.skip
const databaseName = `sauryctf_fault_${randomUUID().replaceAll('-', '')}`
const unavailableEndpoint = 'http://127.0.0.1:1'
const faultDrillTime = new Date('2026-09-02T08:00:00.000Z')

function quotedDatabaseName(): string {
  if (!/^sauryctf_fault_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected database name')
  return `"${databaseName}"`
}

describeFaultDrill('authoritative dependency fault recovery', () => {
  let admin: Client
  let database: PostgresTestDatabase
  let userId: string
  const storageKeys = new Set<string>()
  const liveS3Config: S3ContentObjectStoreConfig = {
    endpoint: s3Endpoint!,
    region: process.env.TEST_S3_REGION ?? 'us-east-1',
    bucket: process.env.TEST_S3_BUCKET ?? 'sauryctf',
    accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? 'sauryctf',
    secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'sauryctf-fault-secret',
    forcePathStyle: true,
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const databaseUrl = new URL(adminConnectionString!)
    databaseUrl.pathname = `/${databaseName}`
    database = createPostgresTestDatabase({
      connectionString: databaseUrl.toString(),
      applicationName: 'sauryctf-dependency-fault-drill',
      maxConnections: 8,
    })
    await runPostgresTestMigrations(database)
    const user = await database.executor.query<{ id: string }>(`
      INSERT INTO users
        (username, username_normalized, email, email_normalized, email_verified_at)
      VALUES ('FaultDrillUser', 'faultdrilluser',
              'fault-drill@example.test', 'fault-drill@example.test', now())
      RETURNING id`)
    userId = user.rows[0]!.id
  })

  afterAll(async () => {
    if (s3Endpoint) {
      const store = new S3ContentObjectStore(liveS3Config)
      for (const storageKey of storageKeys) await store.delete(storageKey)
      store.close()
    }
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

  it('keeps content metadata authoritative during an object-store outage and reads bytes after recovery', async () => {
    const body = Buffer.from(`fault-drill-object-${randomUUID()}`)
    const digest = createHash('sha256').update(body).digest('hex')
    const firstStore = new S3ContentObjectStore(liveS3Config)
    const firstService = new ContentObjectService(
      new PostgresContentObjectRepository(database.executor),
      firstStore,
    )
    const temporary = await firstService.uploadTemporary(userId, {
      body,
      mediaType: 'application/octet-stream',
      originalFilename: 'fault-drill.bin',
    })
    storageKeys.add(temporary.storageKey)
    const committed = await firstService.commitTemporary(userId, temporary.id, digest)
    firstStore.close()

    const unavailableStore = new S3ContentObjectStore({
      ...liveS3Config,
      endpoint: unavailableEndpoint,
    })
    await expect(unavailableStore.read(committed.storageKey)).rejects.toBeDefined()
    unavailableStore.close()

    const metadata = await database.executor.query<{
      status: string
      sha256_hex: string
      size_bytes: string
      storage_key: string
    }>(`
      SELECT status::text, encode(sha256_digest, 'hex') AS sha256_hex,
             size_bytes::text, storage_key
      FROM content_objects WHERE id = $1`, [committed.id])
    expect(metadata.rows).toEqual([{
      status: 'committed',
      sha256_hex: digest,
      size_bytes: String(body.byteLength),
      storage_key: committed.storageKey,
    }])

    const recoveredStore = new S3ContentObjectStore(liveS3Config)
    const recoveredBody = await recoveredStore.read(committed.storageKey)
    expect(Buffer.from(recoveredBody!)).toEqual(body)
    recoveredStore.close()
  }, 20_000)

  it('keeps notification facts and retries the same message after SMTP recovery', async () => {
    const recipient = `fault-${randomUUID()}@example.test`
    const event = await database.executor.query<{ id: string }>(`
      INSERT INTO domain_outbox
        (aggregate_type, aggregate_id, event_type, dedupe_key, payload)
      VALUES ('user', $1, 'identity.password_changed', $2, '{}')
      RETURNING id`, [userId, `fault-mail-${randomUUID()}`])
    const eventId = event.rows[0]!.id
    await database.executor.query(`
      INSERT INTO notifications (user_id, source_event_id, template_key, payload)
      VALUES ($1, $2, 'identity.password_changed', '{}')`, [userId, eventId])
    const delivery = await database.executor.query<{ id: string }>(`
      INSERT INTO mail_deliveries
        (source_event_id, recipient, recipient_normalized, template_key, payload, available_at)
      VALUES ($1, $2, $2, 'identity.password_changed', '{"locale":"zh-CN"}', $3)
      RETURNING id`, [eventId, recipient, faultDrillTime])
    const deliveryId = delivery.rows[0]!.id
    const tokenProtector = new AesGcmIdentityMailTokenProtector(
      'fault-drill-mail-token-secret-that-is-at-least-32-characters',
    )
    let currentTime = faultDrillTime
    const repository = new PostgresMailOutboxRepository(database.executor)
    const unavailableDispatcher = new MailOutboxDispatcher(
      'control-plane-before-mail-recovery',
      repository,
      new SmtpMailTransport({
        host: '127.0.0.1',
        port: 1,
        from: 'SauryCTF <noreply@example.test>',
        publicOrigin: 'https://ctf.example.test',
      }, tokenProtector),
      () => currentTime,
    )
    await expect(unavailableDispatcher.runOnce()).resolves.toBe(1)

    const retrying = await database.executor.query<{
      status: string
      attempt_count: number
      notification_count: number
    }>(`
      SELECT delivery.status::text, delivery.attempt_count,
             (SELECT count(*)::int FROM notifications WHERE source_event_id = $2) AS notification_count
      FROM mail_deliveries AS delivery WHERE delivery.id = $1`, [deliveryId, eventId])
    expect(retrying.rows).toEqual([{
      status: 'retry_wait',
      attempt_count: 1,
      notification_count: 1,
    }])

    currentTime = new Date(currentTime.getTime() + 1_000)
    const recoveredDispatcher = new MailOutboxDispatcher(
      'control-plane-after-mail-recovery',
      repository,
      new SmtpMailTransport({
        host: smtpHost!,
        port: smtpPort,
        from: 'SauryCTF <noreply@example.test>',
        publicOrigin: 'https://ctf.example.test',
      }, tokenProtector),
      () => currentTime,
    )
    await expect(recoveredDispatcher.runOnce()).resolves.toBe(1)
    await expect(recoveredDispatcher.runOnce()).resolves.toBe(0)

    const sent = await database.executor.query<{ status: string, attempt_count: number }>(`
      SELECT status::text, attempt_count FROM mail_deliveries WHERE id = $1`, [deliveryId])
    expect(sent.rows).toEqual([{ status: 'sent', attempt_count: 2 }])
    await expect(waitForMailpitMessage(mailpitApiUrl!, recipient)).resolves.toBe(true)
  }, 20_000)
})

async function waitForMailpitMessage(apiUrl: string, recipient: string): Promise<boolean> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const response = await fetch(`${apiUrl.replace(/\/$/u, '')}/api/v1/messages`)
    if (response.ok && JSON.stringify(await response.json()).includes(recipient)) return true
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}
