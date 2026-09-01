import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DomainOutboxDispatcher } from '../../domains/events/domain-outbox'
import { createDatabaseClient, type DatabaseClient } from './client'
import { runMigrations } from './migrate'
import { PostgresDomainOutboxRepository } from './domain-outbox-repository'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName() {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected database name')
  return `"${databaseName}"`
}

describeWithPostgres('PostgreSQL domain outbox dispatch', () => {
  let admin: Client
  let database: DatabaseClient
  let contestId: string

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 6 })
    await runMigrations(database)
    const user = await database.pool.query<{ id: string }>(
      `INSERT INTO users (username, username_normalized, email, email_normalized)
       VALUES ('OutboxOwner', 'outboxowner', 'outbox@example.test', 'outbox@example.test')
       RETURNING id`,
    )
    const contest = await database.pool.query<{ id: string }>(
      `INSERT INTO contests (title, slug, start_at, end_at, created_by)
       VALUES ('Outbox Contest', $1, $2, $3, $4) RETURNING id`,
      [
        `outbox-${randomUUID()}`,
        new Date('2026-09-01T07:00:00.000Z'),
        new Date('2026-09-01T09:00:00.000Z'),
        user.rows[0]!.id,
      ],
    )
    contestId = contest.rows[0]!.id
    await database.pool.query(
      'INSERT INTO scoreboard_versions (contest_id, version) VALUES ($1, 1)',
      [contestId],
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

  it('retries publication without recreating or advancing the business fact', async () => {
    const event = await database.pool.query<{ id: string }>(
      `INSERT INTO domain_outbox
         (aggregate_type, aggregate_id, event_type, dedupe_key, payload,
          occurred_at, available_at)
       VALUES ('contest', $1, 'scoreboard.version_changed', $2, $3, $4, $4)
       RETURNING id`,
      [
        contestId,
        `scoreboard:${contestId}:test:${randomUUID()}`,
        { contest_id: contestId, version: 1, reason: 'test' },
        new Date('2026-09-01T08:00:00.000Z'),
      ],
    )
    let now = new Date('2026-09-01T08:00:00.000Z')
    const publish = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue('published')
    const dispatcher = new DomainOutboxDispatcher(
      new PostgresDomainOutboxRepository(database.pool),
      { publish },
      () => now,
    )

    expect(await dispatcher.runOnce()).toBe(1)
    let state = await database.pool.query<{
      attempt_count: number
      published_at: Date | null
      last_error: string | null
      version: string
      event_count: string
    }>(
      `SELECT outbox.attempt_count, outbox.published_at, outbox.last_error,
              version.version::text,
              (SELECT count(*)::text FROM domain_outbox WHERE id = outbox.id) AS event_count
       FROM domain_outbox outbox
       JOIN scoreboard_versions version ON version.contest_id = outbox.aggregate_id
       WHERE outbox.id = $1`,
      [event.rows[0]!.id],
    )
    expect(state.rows[0]).toMatchObject({
      attempt_count: 1,
      published_at: null,
      last_error: 'Error',
      version: '1',
      event_count: '1',
    })

    now = new Date('2026-09-01T08:00:02.000Z')
    expect(await dispatcher.runOnce()).toBe(1)
    expect(await dispatcher.runOnce()).toBe(0)
    state = await database.pool.query(
      `SELECT outbox.attempt_count, outbox.published_at, outbox.last_error,
              version.version::text,
              (SELECT count(*)::text FROM domain_outbox WHERE id = outbox.id) AS event_count
       FROM domain_outbox outbox
       JOIN scoreboard_versions version ON version.contest_id = outbox.aggregate_id
       WHERE outbox.id = $1`,
      [event.rows[0]!.id],
    )
    expect(state.rows[0]).toMatchObject({
      attempt_count: 2,
      last_error: null,
      version: '1',
      event_count: '1',
    })
    expect(state.rows[0]!.published_at).toBeInstanceOf(Date)
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it('leases one event to only one concurrent dispatcher', async () => {
    await database.pool.query(
      `INSERT INTO domain_outbox
         (aggregate_type, aggregate_id, event_type, dedupe_key, payload,
          occurred_at, available_at)
       VALUES ('contest', $1, 'contest.updated', $2, '{}', $3, $3)`,
      [
        contestId,
        `contest:${contestId}:test:${randomUUID()}`,
        new Date('2026-09-01T08:00:00.000Z'),
      ],
    )
    const publish = vi.fn(async () => 'published' as const)
    const first = new DomainOutboxDispatcher(
      new PostgresDomainOutboxRepository(database.pool),
      { publish },
      () => new Date('2026-09-01T08:01:00.000Z'),
    )
    const second = new DomainOutboxDispatcher(
      new PostgresDomainOutboxRepository(database.pool),
      { publish },
      () => new Date('2026-09-01T08:01:00.000Z'),
    )

    const claimed = await Promise.all([first.runOnce(1), second.runOnce(1)])
    expect(claimed.reduce((sum, count) => sum + count, 0)).toBe(1)
    expect(publish).toHaveBeenCalledOnce()
  })
})
