import {
  criticalSchemaFingerprint,
  expectedMigrationBaseline,
  verifyMigrationBaselineFiles,
  type MigrationBaselineEntry,
} from './migration-baseline'

export type LegacyMigrationRow = {
  hash: string
  createdAt: number
}

export type LiveSchemaFingerprint = {
  relations: readonly string[]
  columns: readonly string[]
  indexes: readonly string[]
}

export interface MigrationTakeoverTransaction {
  readLegacyJournal(): Promise<LegacyMigrationRow[] | null>
  readHubJournal(): Promise<string[] | null>
  readSchemaFingerprint(): Promise<LiveSchemaFingerprint>
  hasApplicationRelations(): Promise<boolean>
  createHubJournal(): Promise<void>
  insertHubMigration(name: string): Promise<void>
}

export interface MigrationTakeoverDatabase {
  transaction<T>(work: (transaction: MigrationTakeoverTransaction) => Promise<T>): Promise<T>
}

export type MigrationTakeoverResult = {
  state: 'empty' | 'claimed' | 'already-claimed'
  migrations: number
}

export async function takeOverLegacyDrizzleJournal(
  database: MigrationTakeoverDatabase,
  options: {
    verifyFiles?: () => Promise<void>
    baseline?: MigrationBaselineEntry[]
    schemaFingerprint?: LiveSchemaFingerprint
  } = {},
): Promise<MigrationTakeoverResult> {
  await (options.verifyFiles ?? verifyMigrationBaselineFiles)()
  const baseline = options.baseline ?? expectedMigrationBaseline()
  const expectedSchema = options.schemaFingerprint ?? criticalSchemaFingerprint

  return database.transaction(async (transaction) => {
    const existingHubJournal = await transaction.readHubJournal()
    const legacy = await transaction.readLegacyJournal()
    if (legacy === null) {
      if (existingHubJournal && existingHubJournal.length > 0) {
        return { state: 'already-claimed', migrations: existingHubJournal.length }
      }
      if (await transaction.hasApplicationRelations()) {
        throw new Error('数据库包含未知 schema，拒绝认领历史迁移')
      }
      return { state: 'empty', migrations: 0 }
    }

    assertLegacyJournal(legacy, baseline)
    assertLiveSchemaFingerprint(await transaction.readSchemaFingerprint(), expectedSchema)

    const existingHubMigrations = existingHubJournal ?? []
    const expectedNames = new Set(baseline.map(migration => migration.name))
    const unknown = existingHubMigrations.filter(name => !expectedNames.has(name))
    if (unknown.length > 0) throw new Error('NuxtHub journal 包含未知历史迁移')

    const existing = new Set(existingHubMigrations)
    await transaction.createHubJournal()
    for (const migration of baseline) {
      if (!existing.has(migration.name)) await transaction.insertHubMigration(migration.name)
    }

    return {
      state: existingHubMigrations.length === baseline.length ? 'already-claimed' : 'claimed',
      migrations: baseline.length,
    }
  })
}

export function assertLegacyJournal(
  actual: LegacyMigrationRow[],
  baseline = expectedMigrationBaseline(),
): void {
  if (actual.length !== baseline.length) throw new Error('旧 Drizzle journal 迁移数量不匹配')
  for (let index = 0; index < baseline.length; index += 1) {
    const actualEntry = actual[index]!
    const expectedEntry = baseline[index]!
    if (actualEntry.createdAt !== expectedEntry.legacyCreatedAt) {
      throw new Error(`旧 Drizzle journal 顺序或时间不匹配：${expectedEntry.name}`)
    }
    if (actualEntry.hash !== expectedEntry.sha256) {
      throw new Error(`旧 Drizzle journal hash 不匹配：${expectedEntry.name}`)
    }
  }
}

export function assertLiveSchemaFingerprint(
  actual: LiveSchemaFingerprint,
  expected: LiveSchemaFingerprint = criticalSchemaFingerprint,
): void {
  for (const kind of ['relations', 'columns', 'indexes'] as const) {
    const actualValues = new Set(actual[kind])
    const missing = expected[kind].filter(value => !actualValues.has(value))
    if (missing.length > 0) throw new Error(`数据库 schema 指纹不匹配：缺少 ${kind}`)
  }
}
