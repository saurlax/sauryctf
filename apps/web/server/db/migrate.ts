import { readFile, readdir } from 'node:fs/promises'
import postgres, { type Sql } from 'postgres'
import {
  defaultMigrationsDirectory,
  verifyMigrationBaselineFiles,
} from './migration-baseline'
import { createPostgresTakeoverDatabase } from './takeover-postgres'
import { takeOverLegacyDrizzleJournal } from './takeover'

export type MigrationFile = {
  name: string
  statements: string[]
}

export type MigrationRunResult = {
  applied: string[]
  total: number
}

export async function loadMigrationFiles(
  directory = defaultMigrationsDirectory,
): Promise<MigrationFile[]> {
  const filenames = (await readdir(directory))
    .filter(filename => /^\d{4}_.+\.sql$/u.test(filename))
    .sort()
  return Promise.all(filenames.map(async (filename) => ({
    name: filename.slice(0, -4),
    statements: splitMigrationStatements(await readFile(`${directory}/${filename}`, 'utf8')),
  })))
}

export function splitMigrationStatements(source: string): string[] {
  return source
    .split(/^\s*-->\s*statement-breakpoint\s*$/gmu)
    .map(statement => statement.trim())
    .filter(Boolean)
}

export async function runNuxtHubMigrations(options: {
  databaseUrl: string
  migrations?: MigrationFile[]
  verifyBaseline?: () => Promise<void>
}): Promise<MigrationRunResult> {
  await (options.verifyBaseline ?? verifyMigrationBaselineFiles)()
  const migrations = options.migrations ?? await loadMigrationFiles()
  assertUniqueOrderedMigrationNames(migrations)

  const takeoverDatabase = createPostgresTakeoverDatabase(options.databaseUrl)
  try {
    await takeOverLegacyDrizzleJournal(takeoverDatabase, {
      verifyFiles: options.verifyBaseline ?? verifyMigrationBaselineFiles,
    })
  }
  finally {
    await takeoverDatabase.close()
  }

  const sql = postgres(options.databaseUrl, {
    max: 1,
    connection: { application_name: 'sauryctf-migrator' },
    onnotice: () => {},
  })
  try {
    await ensureHubJournal(sql)
    const appliedNames = await readAppliedMigrationNames(sql)
    assertAppliedMigrationsArePrefix(appliedNames, migrations.map(migration => migration.name))
    const pending = migrations.slice(appliedNames.length)

    for (const migration of pending) {
      await sql.begin(async (transaction) => {
        for (const statement of migration.statements) await transaction.unsafe(statement)
        await transaction`
          INSERT INTO public._hub_migrations (name)
          VALUES (${migration.name})
        `
      })
    }
    return { applied: pending.map(migration => migration.name), total: migrations.length }
  }
  finally {
    await sql.end()
  }
}

function assertUniqueOrderedMigrationNames(migrations: MigrationFile[]): void {
  const names = migrations.map(migration => migration.name)
  if (new Set(names).size !== names.length) throw new Error('本地迁移名称重复')
  const sorted = [...names].sort()
  if (names.some((name, index) => name !== sorted[index])) throw new Error('本地迁移顺序无效')
}

function assertAppliedMigrationsArePrefix(applied: string[], local: string[]): void {
  if (applied.length > local.length) throw new Error('NuxtHub journal 比当前构建更新')
  for (let index = 0; index < applied.length; index += 1) {
    if (applied[index] !== local[index]) {
      throw new Error(`NuxtHub journal 与当前迁移清单不一致：位置 ${index}`)
    }
  }
}

async function ensureHubJournal(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public._hub_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
  `
}

async function readAppliedMigrationNames(sql: Sql): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    SELECT name FROM public._hub_migrations ORDER BY id
  `
  return rows.map(row => row.name)
}
