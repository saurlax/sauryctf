import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabaseClient, type DatabaseClient } from './client'
import { runMigrations } from './migrate'
import { PostgresControlPlaneReadiness } from './readiness'

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
    await expect(new PostgresControlPlaneReadiness(database.pool).ready())
      .rejects.toThrow('migration journal is unavailable')

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
    await expect(new PostgresControlPlaneReadiness(database.pool).ready()).resolves.toBeUndefined()
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

  it('fails closed when the database is not at the bundled migration version', async () => {
    const client = await database.pool.connect()
    await client.query('BEGIN')
    try {
      await client.query(`DELETE FROM control_plane.__drizzle_migrations
                          WHERE created_at = (SELECT max(created_at)
                                              FROM control_plane.__drizzle_migrations)`)
      await expect(new PostgresControlPlaneReadiness(client).ready())
        .rejects.toThrow('migration version does not match')
    }
    finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
