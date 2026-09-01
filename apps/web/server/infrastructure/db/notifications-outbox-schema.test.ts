import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabaseClient, type DatabaseClient } from './client'
import { runMigrations } from './migrate'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName(): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected test database name')
  return `"${databaseName}"`
}

describeWithPostgres('notification and outbox authority schema', () => {
  let admin: Client
  let database: DatabaseClient
  let userId: string

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 2 })
    await runMigrations(database)

    const user = await database.pool.query<{ id: string }>(
      `INSERT INTO users (username, username_normalized, email, email_normalized)
       VALUES ('NotifyUser', 'notifyuser', 'notify@example.test', 'notify@example.test') RETURNING id`,
    )
    userId = user.rows[0]!.id
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

  it('commits a domain event and in-app notification atomically', async () => {
    const aggregateId = randomUUID()
    const connection = await database.pool.connect()
    try {
      await connection.query('BEGIN')
      const event = await connection.query<{ id: string }>(
        `INSERT INTO domain_outbox (aggregate_type, aggregate_id, event_type, dedupe_key, payload)
         VALUES ('user', $1, 'identity.password_changed', $2, $3) RETURNING id`,
        [aggregateId, `password-changed:${aggregateId}`, { user_id: userId }],
      )
      await connection.query(
        `INSERT INTO notifications (user_id, source_event_id, template_key, payload)
         VALUES ($1, $2, 'identity.password_changed', $3)`,
        [userId, event.rows[0]!.id, { user_id: userId }],
      )
      await connection.query('COMMIT')

      const persisted = await database.pool.query<{ event_count: string, notification_count: string }>(
        `SELECT
           (SELECT count(*)::text FROM domain_outbox WHERE aggregate_id = $1) AS event_count,
           (SELECT count(*)::text FROM notifications WHERE source_event_id = $2) AS notification_count`,
        [aggregateId, event.rows[0]!.id],
      )
      expect(persisted.rows[0]).toEqual({ event_count: '1', notification_count: '1' })
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
  })

  it('rolls back the event when notification creation fails', async () => {
    const aggregateId = randomUUID()
    const connection = await database.pool.connect()
    await connection.query('BEGIN')
    const event = await connection.query<{ id: string }>(
      `INSERT INTO domain_outbox (aggregate_type, aggregate_id, event_type, dedupe_key)
       VALUES ('user', $1, 'identity.email_verified', $2) RETURNING id`,
      [aggregateId, `email-verified:${aggregateId}`],
    )
    await expect(connection.query(
      `INSERT INTO notifications (user_id, source_event_id, template_key)
       VALUES ($1, $2, '')`,
      [userId, event.rows[0]!.id],
    )).rejects.toMatchObject({ code: '23514' })
    await connection.query('ROLLBACK')
    connection.release()

    const persisted = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM domain_outbox WHERE aggregate_id = $1',
      [aggregateId],
    )
    expect(persisted.rows[0]!.count).toBe('0')
  })

  it('deduplicates repeated mail consumer delivery creation', async () => {
    const aggregateId = randomUUID()
    const event = await database.pool.query<{ id: string }>(
      `INSERT INTO domain_outbox (aggregate_type, aggregate_id, event_type, dedupe_key)
       VALUES ('user', $1, 'identity.password_reset_requested', $2) RETURNING id`,
      [aggregateId, `password-reset:${aggregateId}`],
    )
    const parameters = [event.rows[0]!.id, 'Player@Example.test', 'player@example.test']
    const consume = () => database.pool.query(
      `INSERT INTO mail_deliveries
         (source_event_id, recipient, recipient_normalized, template_key)
       VALUES ($1, $2, $3, 'identity.password_reset_requested')
       ON CONFLICT (source_event_id, recipient_normalized, template_key) DO NOTHING`,
      parameters,
    )

    await Promise.all([consume(), consume()])
    const deliveries = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM mail_deliveries WHERE source_event_id = $1',
      [event.rows[0]!.id],
    )
    expect(deliveries.rows[0]!.count).toBe('1')
  })
})
