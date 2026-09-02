import { randomUUID } from 'node:crypto'
import { PostgresTestClient as Client } from '../../test-support/postgres-database'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { runPostgresTestMigrations } from '../../test-support/postgres-database'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName(): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected test database name')
  return `"${databaseName}"`
}

describeWithPostgres('instance orchestration authority schema', () => {
  let admin: Client
  let database: PostgresTestDatabase

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createPostgresTestDatabase({ connectionString: url.toString(), maxConnections: 2 })
    await runPostgresTestMigrations(database)
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

  it('stores separate desired and observed instance generations', async () => {
    const columns = await database.executor.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'instances'
         AND column_name IN (
           'desired_state', 'desired_generation', 'observed_state', 'observed_generation',
           'provider_resource_id', 'entrypoints', 'last_observed_at', 'last_error_code'
         )
       ORDER BY column_name`,
    )
    expect(columns.rows.map(row => row.column_name)).toEqual([
      'desired_generation',
      'desired_state',
      'entrypoints',
      'last_error_code',
      'last_observed_at',
      'observed_generation',
      'observed_state',
      'provider_resource_id',
    ])
  })

  it('exposes only the dedicated instance operation set', async () => {
    const values = await database.executor.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum
       JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
       WHERE pg_type.typname = 'instance_job_operation'
       ORDER BY enumsortorder`,
    )
    expect(values.rows.map(row => row.enumlabel)).toEqual(['ensure', 'inspect', 'destroy', 'reconcile'])

    for (const forbidden of ['checker', 'vpn', 'terminal', 'execute_code']) {
      await expect(database.executor.query('SELECT $1::instance_job_operation', [forbidden]))
        .rejects.toMatchObject({ code: '22P02' })
    }
  })

  it('keeps attempts and fencing fields in the durable job protocol', async () => {
    const tables = await database.executor.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('instances', 'instance_jobs', 'instance_job_attempts')
       ORDER BY table_name`,
    )
    expect(tables.rows.map(row => row.table_name)).toEqual(['instance_job_attempts', 'instance_jobs', 'instances'])

    const columns = await database.executor.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'instance_jobs'
         AND column_name IN ('payload_version', 'desired_generation', 'idempotency_key', 'lease_owner', 'lease_until', 'fencing_token', 'attempt_count')
       ORDER BY column_name`,
    )
    expect(columns.rows).toHaveLength(7)
  })

  it('persists deduplicated orphan reports for manual disposition', async () => {
    const columns = await database.executor.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'instance_orphan_reports'
       ORDER BY column_name`,
    )
    expect(columns.rows.map(row => row.column_name)).toEqual([
      'claimed_generation',
      'claimed_instance_id',
      'first_seen_at',
      'id',
      'last_seen_at',
      'occurrences',
      'ownership_labels',
      'provider',
      'provider_resource_id',
      'reason',
      'resolved_at',
    ])

    await database.executor.query(
      `INSERT INTO instance_orphan_reports (
         provider, provider_resource_id, claimed_instance_id, claimed_generation,
         reason, ownership_labels
       ) VALUES ('docker', 'container/orphan', $1, 7, 'unknown_instance', $2::jsonb)`,
      ['018f47a2-4ef8-7e2c-9c24-000000000099', JSON.stringify({ 'sauryctf.io/managed-by': 'sauryctf' })],
    )
    await expect(database.executor.query(
      `INSERT INTO instance_orphan_reports (
         provider, provider_resource_id, reason, ownership_labels
       ) VALUES ('docker', 'container/orphan', 'unknown_instance', '{}'::jsonb)`,
    )).rejects.toMatchObject({ code: '23505' })
  })
})
