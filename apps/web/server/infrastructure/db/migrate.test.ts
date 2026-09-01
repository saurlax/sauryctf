import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabaseClient, type DatabaseClient } from './client'
import { runMigrations } from './migrate'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quoteIdentifier(identifier: string): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('Refusing to use an unexpected test database name')
  }
  return `"${identifier}"`
}

function databaseUrl(adminUrl: string, name: string): string {
  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  return url.toString()
}

describeWithPostgres('PostgreSQL migration lifecycle', () => {
  let admin: Client
  let database: DatabaseClient

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
    database = createDatabaseClient({
      connectionString: databaseUrl(adminConnectionString!, databaseName),
      applicationName: 'sauryctf-migration-test',
      maxConnections: 2,
    })
  })

  afterAll(async () => {
    if (database) await database.pool.end()
    if (admin) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [databaseName],
      )
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`)
      await admin.end()
    }
  })

  it('upgrades an empty database', async () => {
    await runMigrations(database)

    const metadata = await database.pool.query<{ key: string }>(
      'SELECT key FROM control_plane.runtime_metadata WHERE key = $1',
      ['schema'],
    )
    const migrations = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM control_plane.__drizzle_migrations',
    )

    expect(metadata.rows).toEqual([{ key: 'schema' }])
    expect(Number(migrations.rows[0]?.count)).toBeGreaterThan(0)
  })

  it('is idempotent when migrations run again', async () => {
    const before = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM control_plane.__drizzle_migrations',
    )

    await runMigrations(database)

    const after = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM control_plane.__drizzle_migrations',
    )
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count)
  })
})
