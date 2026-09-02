import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgresControlPlaneReadiness } from '../infrastructure/db/readiness'
import { currentMigrationNames, expectedMigrationBaseline } from './migration-baseline'
import {
  loadMigrationFiles,
  runNuxtHubMigrations,
  splitMigrationStatements,
  type MigrationFile,
} from './migrate'

const adminDatabaseUrl = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminDatabaseUrl ? describe : describe.skip

describe('migration SQL splitting', () => {
  it('preserves semicolons inside a dollar-quoted PostgreSQL function', () => {
    const source = `CREATE FUNCTION example() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1;
END;
$$;
--> statement-breakpoint
CREATE TABLE example_table (id integer);`
    expect(splitMigrationStatements(source)).toEqual([
      expect.stringContaining('PERFORM 1;'),
      'CREATE TABLE example_table (id integer);',
    ])
  })
})

describeWithPostgres('NuxtHub-compatible PostgreSQL migration lifecycle', () => {
  let admin: Sql
  const databases = new Set<string>()

  beforeAll(() => {
    admin = postgres(adminDatabaseUrl!, { max: 1, onnotice: () => {} })
  })

  afterAll(async () => {
    for (const name of databases) await dropDatabase(admin, name)
    await admin.end()
  })

  it('migrates an empty database exactly once, including PL/pgSQL functions', async () => {
    const target = await createDatabase(admin, databases)
    const first = await runNuxtHubMigrations({ databaseUrl: target.url })
    const second = await runNuxtHubMigrations({ databaseUrl: target.url })
    const sql = postgres(target.url, { max: 1, onnotice: () => {} })
    try {
      const [journal] = await sql<{ count: number }[]>`
        SELECT count(*)::integer AS count FROM public._hub_migrations
      `
      const [functionBody] = await sql<{ name: string | null }[]>`
        SELECT to_regprocedure('public.apply_data_retention(timestamp with time zone,timestamp with time zone,integer)')::text AS name
      `
      expect(first.applied).toHaveLength(currentMigrationNames.length)
      expect(second.applied).toEqual([])
      expect(journal?.count).toBe(currentMigrationNames.length)
      expect(functionBody?.name).toContain('apply_data_retention')
      await expect(new PostgresControlPlaneReadiness(readinessAdapter(sql)).ready())
        .resolves.toBeUndefined()
    }
    finally {
      await sql.end()
    }
  }, 60_000)

  it('claims an existing complete Drizzle baseline without replaying historical DDL', async () => {
    const target = await createDatabase(admin, databases)
    await seedLegacyDatabase(target.url)

    const result = await runNuxtHubMigrations({ databaseUrl: target.url })
    const sql = postgres(target.url, { max: 1, onnotice: () => {} })
    try {
      const [hub] = await sql<{ count: number }[]>`
        SELECT count(*)::integer AS count FROM public._hub_migrations
      `
      const [legacy] = await sql<{ count: number }[]>`
        SELECT count(*)::integer AS count FROM control_plane.__drizzle_migrations
      `
      expect(result.applied).toEqual(['0022_rate_limit_windows'])
      expect(hub?.count).toBe(currentMigrationNames.length)
      expect(legacy?.count).toBe(expectedMigrationBaseline().length)
      await expect(new PostgresControlPlaneReadiness(readinessAdapter(sql)).ready())
        .resolves.toBeUndefined()
    }
    finally {
      await sql.end()
    }
  }, 60_000)

  it('rejects an unknown populated schema before creating the NuxtHub journal', async () => {
    const target = await createDatabase(admin, databases)
    const sql = postgres(target.url, { max: 1, onnotice: () => {} })
    try {
      await sql`CREATE TABLE public.unknown_business_data (id integer PRIMARY KEY)`
      await expect(runNuxtHubMigrations({ databaseUrl: target.url }))
        .rejects.toThrow('未知 schema')
      const [journal] = await sql<{ name: string | null }[]>`
        SELECT to_regclass('public._hub_migrations')::text AS name
      `
      expect(journal?.name).toBeNull()
    }
    finally {
      await sql.end()
    }
  })

  it('rolls back a failed migration and does not write its journal row', async () => {
    const target = await createDatabase(admin, databases)
    await runNuxtHubMigrations({ databaseUrl: target.url })
    const migrations: MigrationFile[] = [
      ...await loadMigrationFiles(),
      {
        name: '9999_expected_failure',
        statements: [
          'CREATE TABLE public.migration_rollback_probe (id integer)',
          'THIS IS NOT VALID POSTGRESQL',
        ],
      },
    ]
    await expect(runNuxtHubMigrations({
      databaseUrl: target.url,
      migrations,
    })).rejects.toThrow()

    const sql = postgres(target.url, { max: 1, onnotice: () => {} })
    try {
      const [state] = await sql<{ table_name: string | null, journal_count: number }[]>`
        SELECT
          to_regclass('public.migration_rollback_probe')::text AS table_name,
          (SELECT count(*)::integer FROM public._hub_migrations WHERE name = '9999_expected_failure') AS journal_count
      `
      expect(state).toEqual({ table_name: null, journal_count: 0 })
    }
    finally {
      await sql.end()
    }
  }, 60_000)
})

async function seedLegacyDatabase(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} })
  const migrations = await loadMigrationFiles()
  const baseline = expectedMigrationBaseline()
  try {
    await sql`CREATE SCHEMA control_plane`
    await sql`
      CREATE TABLE control_plane.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `
    for (let index = 0; index < baseline.length; index += 1) {
      const migration = migrations[index]!
      const entry = baseline[index]!
      await sql.begin(async (transaction) => {
        for (const statement of migration.statements) await transaction.unsafe(statement)
        await transaction`
          INSERT INTO control_plane.__drizzle_migrations (hash, created_at)
          VALUES (${entry.sha256}, ${entry.legacyCreatedAt})
        `
      })
    }
  }
  finally {
    await sql.end()
  }
}

async function createDatabase(admin: Sql, databases: Set<string>) {
  const name = `sauryctf_nuxthub_${randomUUID().replaceAll('-', '')}`
  assertTestDatabaseName(name)
  await admin.unsafe(`CREATE DATABASE "${name}"`)
  databases.add(name)
  const url = new URL(adminDatabaseUrl!)
  url.pathname = `/${name}`
  return { name, url: url.toString() }
}

async function dropDatabase(admin: Sql, name: string): Promise<void> {
  assertTestDatabaseName(name)
  await admin`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${name} AND pid <> pg_backend_pid()`
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`)
}

function assertTestDatabaseName(name: string): void {
  if (!/^sauryctf_nuxthub_[a-f0-9]{32}$/u.test(name)) {
    throw new Error('Refusing to operate on an unexpected test database name')
  }
}

function readinessAdapter(sql: Sql) {
  return {
    query: async (text: string) => ({ rows: await sql.unsafe(text) }),
  } as never
}
