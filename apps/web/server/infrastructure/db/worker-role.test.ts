import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabaseClient, type DatabaseClient } from './client'
import { runMigrations } from './migrate'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const suffix = randomUUID().replaceAll('-', '')
const databaseName = `sauryctf_test_${suffix}`
const loginRole = `sauryctf_worker_test_${suffix}`
const loginPassword = `test-only-${randomUUID()}`

function quoteDatabase(identifier: string): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(identifier)) throw new Error('Unexpected test database name')
  return `"${identifier}"`
}

function quoteLoginRole(identifier: string): string {
  if (!/^sauryctf_worker_test_[a-f0-9]{32}$/u.test(identifier)) throw new Error('Unexpected Worker test role')
  return `"${identifier}"`
}

function databaseUrl(source: string, name: string): string {
  const url = new URL(source)
  url.pathname = `/${name}`
  return url.toString()
}

function workerUrl(source: string): string {
  const url = new URL(databaseUrl(source, databaseName))
  url.username = loginRole
  url.password = loginPassword
  return url.toString()
}

describeWithPostgres('restricted instance Worker database role', () => {
  let admin: Client
  let database: DatabaseClient
  let worker: Pool
  let loginRoleCreated = false

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quoteDatabase(databaseName)}`)
    database = createDatabaseClient({
      connectionString: databaseUrl(adminConnectionString!, databaseName),
      applicationName: 'sauryctf-worker-role-test-owner',
      maxConnections: 2,
    })
    await runMigrations(database)
    const roleScript = await readFile(
      fileURLToPath(new URL('../../../../../deploy/postgres/worker-role.sql', import.meta.url)),
      'utf8',
    )
    await database.pool.query(roleScript)
    const createRole = await admin.query<{ statement: string }>(
      `SELECT format(
         'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
         $1::text, $2::text
       ) AS statement`,
      [loginRole, loginPassword],
    )
    await admin.query(createRole.rows[0]!.statement)
    loginRoleCreated = true
    await admin.query(`GRANT sauryctf_worker TO ${quoteLoginRole(loginRole)}`)
    worker = new Pool({
      connectionString: workerUrl(adminConnectionString!),
      application_name: 'sauryctf-worker-role-test-runtime',
      max: 1,
    })
  })

  afterAll(async () => {
    if (worker) await worker.end()
    if (database) await database.pool.end()
    if (admin) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [databaseName],
      )
      await admin.query(`DROP DATABASE IF EXISTS ${quoteDatabase(databaseName)}`)
      if (loginRoleCreated) {
        await admin.query(`REVOKE sauryctf_worker FROM ${quoteLoginRole(loginRole)}`)
        await admin.query(`DROP ROLE IF EXISTS ${quoteLoginRole(loginRole)}`)
      }
      await admin.end()
    }
  })

  it('allows only the instance facts and observation columns needed by the Worker', async () => {
    const access = await worker.query<{
      current_user: string
      instances: boolean
      jobs: boolean
      attempts: boolean
      orphans: boolean
      observed_update: boolean
      desired_update: boolean
    }>(
      `SELECT current_user,
         has_table_privilege(current_user, 'public.instances', 'SELECT') AS instances,
         has_table_privilege(current_user, 'public.instance_jobs', 'SELECT') AS jobs,
         has_table_privilege(current_user, 'public.instance_job_attempts', 'SELECT') AS attempts,
         has_table_privilege(current_user, 'public.instance_orphan_reports', 'SELECT') AS orphans,
         has_column_privilege(current_user, 'public.instances', 'observed_state', 'UPDATE') AS observed_update,
         has_column_privilege(current_user, 'public.instances', 'desired_state', 'UPDATE') AS desired_update`,
    )
    expect(access.rows).toEqual([{
      current_user: loginRole,
      instances: true,
      jobs: true,
      attempts: true,
      orphans: true,
      observed_update: true,
      desired_update: false,
    }])

    await expect(worker.query(
      `INSERT INTO instance_orphan_reports (
         provider, provider_resource_id, claimed_instance_id, claimed_generation,
         reason, ownership_labels
       ) VALUES ('docker', 'permission-test', $1, 1, 'unknown_instance', $2::jsonb)
       ON CONFLICT (provider, provider_resource_id) DO UPDATE
       SET occurrences = instance_orphan_reports.occurrences + 1,
           last_seen_at = clock_timestamp()`,
      [
        '018f47a2-4ef8-7e2c-9c24-000000000099',
        JSON.stringify({
          'sauryctf.io/managed-by': 'sauryctf',
          'sauryctf.io/contest-id': '018f47a2-4ef8-7e2c-9c24-000000000100',
          'sauryctf.io/challenge-id': '018f47a2-4ef8-7e2c-9c24-000000000101',
          'sauryctf.io/team-id': '018f47a2-4ef8-7e2c-9c24-000000000102',
          'sauryctf.io/instance-id': '018f47a2-4ef8-7e2c-9c24-000000000099',
          'sauryctf.io/generation': '1',
        }),
      ],
    )).resolves.toMatchObject({ rowCount: 1 })
    await expect(worker.query('UPDATE instances SET observed_state = observed_state WHERE false'))
      .resolves.toMatchObject({ rowCount: 0 })
  })

  it.each([
    ['users', 'SELECT * FROM users LIMIT 1'],
    ['teams', 'SELECT * FROM teams LIMIT 1'],
    ['contests', 'SELECT * FROM contests LIMIT 1'],
    ['challenge Flag policy', 'SELECT flag_policy FROM challenge_template_versions LIMIT 1'],
    ['submissions', 'SELECT * FROM submissions LIMIT 1'],
    ['solves', 'SELECT * FROM solves LIMIT 1'],
    ['score adjustments', 'SELECT * FROM score_adjustments LIMIT 1'],
    ['scoreboard snapshots', 'SELECT * FROM scoreboard_snapshots LIMIT 1'],
    ['desired instance state', "UPDATE instances SET desired_state = 'stopped' WHERE false"],
    ['job payload', "UPDATE instance_jobs SET payload = '{}'::jsonb WHERE false"],
    ['instance deletion', 'DELETE FROM instances WHERE false'],
  ])('rejects unauthorized SQL against %s', async (_name, statement) => {
    await expect(worker.query(statement)).rejects.toMatchObject({ code: '42501' })
  })
})
