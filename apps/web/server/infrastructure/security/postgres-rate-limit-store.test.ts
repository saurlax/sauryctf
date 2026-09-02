import { createHash, randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createPostgresTestDatabase,
  runPostgresTestMigrations,
  type PostgresTestDatabase,
} from '../../test-support/postgres-database'
import {
  PostgresRateLimitStore,
  RateLimitStoreUnavailableError,
} from './postgres-rate-limit-store'

const adminDatabaseUrl = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminDatabaseUrl ? describe : describe.skip

describeWithPostgres('PostgreSQL rate limit store', () => {
  let admin: Sql
  let databaseName: string
  let database: PostgresTestDatabase

  beforeAll(async () => {
    admin = postgres(adminDatabaseUrl!, { max: 1, onnotice: () => {} })
    databaseName = `sauryctf_rate_limit_${randomUUID().replaceAll('-', '')}`
    assertDatabaseName(databaseName)
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    const url = new URL(adminDatabaseUrl!)
    url.pathname = `/${databaseName}`
    database = createPostgresTestDatabase({ connectionString: url.toString(), maxConnections: 8 })
    await runPostgresTestMigrations(database)
  })

  afterAll(async () => {
    await database?.close()
    if (admin && databaseName) {
      await admin`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${databaseName} AND pid <> pg_backend_pid()`
      assertDatabaseName(databaseName)
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`)
    }
    await admin?.end()
  })

  it('allows up to the limit and returns a positive retry interval after rejection', async () => {
    const store = new PostgresRateLimitStore(database.executor)
    const bucket = `allowed:${randomUUID()}`
    expect(await store.consume(bucket, 2, 60_000)).toMatchObject({ allowed: true, remaining: 1 })
    expect(await store.consume(bucket, 2, 60_000)).toMatchObject({ allowed: true, remaining: 0 })
    const rejected = await store.consume(bucket, 2, 60_000)
    expect(rejected).toMatchObject({ allowed: false, limit: 2, remaining: 0 })
    expect(rejected.retryAfterMs).toBeGreaterThan(0)
    expect(rejected.retryAfterMs).toBeLessThanOrEqual(60_000)
  })

  it('consumes multiple independent policies in one database round trip', async () => {
    const query = vi.spyOn(database.executor, 'query')
    const store = new PostgresRateLimitStore(database.executor)
    const decisions = await store.consumeMany([
      { bucket: `network:${randomUUID()}`, limit: 10, windowMs: 60_000 },
      { bucket: `action:${randomUUID()}`, limit: 1, windowMs: 60_000 },
    ])
    expect(decisions).toEqual([
      expect.objectContaining({ allowed: true, remaining: 9 }),
      expect.objectContaining({ allowed: true, remaining: 0 }),
    ])
    expect(query).toHaveBeenCalledOnce()
  })

  it('starts a fresh window using PostgreSQL time after the previous window expires', async () => {
    const store = new PostgresRateLimitStore(database.executor)
    const bucket = `window:${randomUUID()}`
    expect((await store.consume(bucket, 1, 10)).allowed).toBe(true)
    await database.executor.query('SELECT pg_sleep(0.02)')
    expect(await store.consume(bucket, 1, 10)).toMatchObject({ allowed: true, remaining: 0 })
  })

  it('shares one atomic count across concurrent repository instances', async () => {
    const replica = createPostgresTestDatabase({
      connectionString: database.connectionString,
      maxConnections: 4,
      applicationName: 'sauryctf-rate-limit-second-replica',
    })
    const first = new PostgresRateLimitStore(database.executor)
    const second = new PostgresRateLimitStore(replica.executor)
    const bucket = `concurrent:${randomUUID()}`
    try {
      const decisions = await Promise.all(Array.from({ length: 20 }, (_, index) => (
        (index % 2 === 0 ? first : second).consume(bucket, 5, 60_000)
      )))
      expect(decisions.filter(decision => decision.allowed)).toHaveLength(5)
      expect(decisions.filter(decision => !decision.allowed)).toHaveLength(15)
    }
    finally {
      await replica.close()
    }
  })

  it('retains an unexpired count when the handling process is recreated', async () => {
    const bucket = `restart:${randomUUID()}`
    const firstProcess = createPostgresTestDatabase({ connectionString: database.connectionString })
    await new PostgresRateLimitStore(firstProcess.executor).consume(bucket, 2, 60_000)
    await firstProcess.close()

    const restartedProcess = createPostgresTestDatabase({ connectionString: database.connectionString })
    try {
      const restarted = new PostgresRateLimitStore(restartedProcess.executor)
      expect((await restarted.consume(bucket, 2, 60_000)).allowed).toBe(true)
      expect((await restarted.consume(bucket, 2, 60_000)).allowed).toBe(false)
    }
    finally {
      await restartedProcess.close()
    }
  })

  it('rolls back every policy when one row violates a database constraint', async () => {
    const store = new PostgresRateLimitStore(database.executor)
    const acceptedBucket = `atomic-accepted:${randomUUID()}`
    const rejectedBucket = `atomic-rejected:${randomUUID()}`
    const rejectedDigest = createHash('sha256').update(rejectedBucket).digest('hex')
    await database.executor.query(`
      CREATE TABLE rate_limit_test_rejections (bucket_digest bytea PRIMARY KEY)
    `)
    await database.executor.query(
      'INSERT INTO rate_limit_test_rejections (bucket_digest) VALUES ($1)',
      [Buffer.from(rejectedDigest, 'hex')],
    )
    await database.executor.query(`
      CREATE FUNCTION reject_test_rate_limit_window() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM rate_limit_test_rejections
          WHERE bucket_digest = NEW.bucket_digest
        ) THEN
          RAISE EXCEPTION 'expected rate limit test rejection' USING ERRCODE = '23000';
        END IF;
        RETURN NEW;
      END;
      $$
    `)
    await database.executor.query(`
      CREATE TRIGGER rate_limit_windows_test_rejection
      BEFORE INSERT OR UPDATE ON rate_limit_windows
      FOR EACH ROW EXECUTE FUNCTION reject_test_rate_limit_window()
    `)
    try {
      await expect(store.consumeMany([
        { bucket: acceptedBucket, limit: 5, windowMs: 60_000 },
        { bucket: rejectedBucket, limit: 5, windowMs: 60_000 },
      ])).rejects.toBeInstanceOf(RateLimitStoreUnavailableError)
      const count = await database.executor.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM rate_limit_windows
        WHERE bucket_digest IN ($1, $2)
      `, [
        Buffer.from(createHash('sha256').update(acceptedBucket).digest('hex'), 'hex'),
        Buffer.from(rejectedDigest, 'hex'),
      ])
      expect(count.rows[0]?.count).toBe(0)
    }
    finally {
      await database.executor.query('DROP TRIGGER rate_limit_windows_test_rejection ON rate_limit_windows')
      await database.executor.query('DROP FUNCTION reject_test_rate_limit_window()')
      await database.executor.query('DROP TABLE rate_limit_test_rejections')
    }
  })

  it('fails before querying when policy input is invalid', async () => {
    const query = vi.fn()
    const store = new PostgresRateLimitStore({ query, transaction: vi.fn() } as never)
    await expect(store.consume('bucket', 0, 60_000)).rejects.toBeInstanceOf(TypeError)
    expect(query).not.toHaveBeenCalled()
  })
})

function assertDatabaseName(name: string): void {
  if (!/^sauryctf_rate_limit_[a-f0-9]{32}$/u.test(name)) {
    throw new Error('Refusing to operate on an unexpected test database name')
  }
}
