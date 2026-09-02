import { randomUUID } from 'node:crypto'
import { Param } from 'drizzle-orm/sql'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { bindSqlParameters, createDatabaseExecutor, DatabaseQueryError } from './executor'

const adminDatabaseUrl = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminDatabaseUrl ? describe : describe.skip

describe('database executor SQL binding', () => {
  it('binds repeated and reordered placeholders without rewriting quoted SQL', () => {
    const query = bindSqlParameters(
      `SELECT '$1' AS literal, $tag$also $2$tag$ AS body, $2 AS second, $1 AS first, $2 AS repeated
       -- $3 is a comment
       /* $4 is another comment */`,
      ['one', 'two'],
    )
    expect(query.queryChunks.filter(chunk => chunk instanceof Param)).toHaveLength(3)
  })

  it('rejects missing and unused bound values before reaching the driver', () => {
    expect(() => bindSqlParameters('SELECT $2', ['one'])).toThrow('SQL placeholder $2 has no bound value')
    expect(() => bindSqlParameters('SELECT $1', ['one', 'two'])).toThrow('SQL value $2 is not referenced')
  })

  it('routes transaction work only through the transaction-scoped Drizzle object', async () => {
    const rootExecute = vi.fn()
    const transactionExecute = vi.fn(async () => Object.assign([{ source: 'transaction' }], { count: 1 }))
    const transactionDatabase = {
      execute: transactionExecute,
      transaction: vi.fn(),
    }
    const rootDatabase = {
      execute: rootExecute,
      transaction: vi.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(transactionDatabase)),
    }
    const executor = createDatabaseExecutor(rootDatabase as never)

    await expect(executor.transaction(transaction => transaction.query('SELECT $1 AS source', ['transaction'])))
      .resolves.toEqual({ rows: [{ source: 'transaction' }], rowCount: 1 })
    expect(rootDatabase.transaction).toHaveBeenCalledOnce()
    expect(transactionExecute).toHaveBeenCalledOnce()
    expect(rootExecute).not.toHaveBeenCalled()
  })
})

describeWithPostgres('NuxtHub PostgreSQL database executor', () => {
  let admin: Sql
  let databaseName: string
  let database: PostgresTestDatabase

  beforeAll(async () => {
    admin = postgres(adminDatabaseUrl!, { max: 1, onnotice: () => {} })
    databaseName = `sauryctf_executor_${randomUUID().replaceAll('-', '')}`
    assertTestDatabaseName(databaseName)
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    const url = new URL(adminDatabaseUrl!)
    url.pathname = `/${databaseName}`
    database = createPostgresTestDatabase({
      connectionString: url.toString(),
      maxConnections: 2,
    })
    await database.executor.query(`
      CREATE TABLE executor_probe (
        id text PRIMARY KEY,
        value text UNIQUE NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        digest bytea,
        payload jsonb
      )
    `)
  })

  afterAll(async () => {
    await database?.close()
    if (admin && databaseName) {
      await admin`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${databaseName} AND pid <> pg_backend_pid()`
      assertTestDatabaseName(databaseName)
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`)
    }
    await admin?.end()
  })

  it('binds values and reports selected and affected row counts', async () => {
    const secret = `value-${randomUUID()}' OR true --`
    const digest = Buffer.from('bound bytes')
    const occurredAt = new Date('2026-09-02T08:00:00.000Z')
    const payload = { safe: true }
    const inserted = await database.executor.query<{
      id: string
      value: string
      occurred_at: Date
      digest: Buffer
      payload: { safe: boolean }
    }>(
      'INSERT INTO executor_probe (id, value, occurred_at, digest, payload) VALUES ($1, $2, $3, $4, $5) RETURNING id, value, occurred_at, digest, payload',
      ['binding', secret, occurredAt, digest, payload],
    )
    const selected = await database.executor.query<{ matches: boolean }>(
      'SELECT value = $1 AS matches FROM executor_probe WHERE id = $2 OR id = $2',
      [secret, 'binding'],
    )
    expect(inserted).toEqual({
      rows: [{
        id: 'binding',
        value: secret,
        occurred_at: occurredAt,
        digest,
        payload,
      }],
      rowCount: 1,
    })
    expect(selected).toEqual({ rows: [{ matches: true }], rowCount: 1 })
  })

  it('commits all statements through the transaction-scoped executor', async () => {
    await database.executor.transaction(async (transaction) => {
      await transaction.query(
        'INSERT INTO executor_probe (id, value) VALUES ($1, $2)',
        ['committed-a', 'committed-a'],
      )
      await transaction.query(
        'INSERT INTO executor_probe (id, value) VALUES ($1, $2)',
        ['committed-b', 'committed-b'],
      )
    })

    const result = await database.executor.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM executor_probe WHERE id IN ($1, $2)`,
      ['committed-a', 'committed-b'],
    )
    expect(result.rows[0]?.count).toBe(2)
  })

  it('rolls back the whole transaction when application work fails', async () => {
    const expected = new Error('expected application failure')
    await expect(database.executor.transaction(async (transaction) => {
      await transaction.query(
        'INSERT INTO executor_probe (id, value) VALUES ($1, $2)',
        ['rolled-back', 'rolled-back'],
      )
      throw expected
    })).rejects.toBe(expected)

    const result = await database.executor.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM executor_probe WHERE id = $1',
      ['rolled-back'],
    )
    expect(result.rows[0]?.count).toBe(0)
  })

  it('maps PostgreSQL failures without exposing query parameters', async () => {
    const secret = `duplicate-${randomUUID()}`
    await database.executor.query(
      'INSERT INTO executor_probe (id, value) VALUES ($1, $2)',
      ['duplicate-a', secret],
    )

    const failure = await database.executor.query(
      'INSERT INTO executor_probe (id, value) VALUES ($1, $2)',
      ['duplicate-b', secret],
    ).catch(error => error)
    expect(failure).toBeInstanceOf(DatabaseQueryError)
    expect(failure).toMatchObject({
      message: 'PostgreSQL query failed',
      code: '23505',
      constraint: 'executor_probe_value_key',
    })
    expect(String(failure)).not.toContain(secret)
    expect(JSON.stringify(failure)).not.toContain(secret)
  })

  it('creates an idempotently closable postgres-js integration client', async () => {
    const url = new URL(adminDatabaseUrl!)
    url.pathname = `/${databaseName}`
    const closable = createPostgresTestDatabase({ connectionString: url.toString() })
    await expect(closable.executor.query('SELECT 1 AS healthy')).resolves.toMatchObject({ rowCount: 1 })
    await closable.close()
    await closable.close()
    await expect(closable.executor.query('SELECT 1')).rejects.toBeInstanceOf(DatabaseQueryError)
  })

  it('respects the configured postgres-js connection budget under concurrent work', async () => {
    await Promise.all(Array.from({ length: 8 }, () => (
      database.executor.query('SELECT pg_sleep(0.01)')
    )))
    const connections = await database.executor.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND application_name = $1`,
      ['sauryctf-integration-test'],
    )
    expect(connections.rows[0]?.count).toBeGreaterThan(0)
    expect(connections.rows[0]?.count).toBeLessThanOrEqual(2)
  })
})

function assertTestDatabaseName(name: string): void {
  if (!/^sauryctf_executor_[a-f0-9]{32}$/u.test(name)) {
    throw new Error('Refusing to operate on an unexpected test database name')
  }
}
