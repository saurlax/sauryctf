import { describe, expect, it } from 'vitest'
import {
  assertMigrationBaseline,
  criticalSchemaFingerprint,
  expectedMigrationBaseline,
  verifyMigrationBaselineFiles,
} from './migration-baseline'
import { loadMigrationFiles } from './migrate'

describe('NuxtHub migration takeover baseline', () => {
  it('matches the committed migration names, order, journal timestamps, and SQL hashes', async () => {
    await expect(verifyMigrationBaselineFiles()).resolves.toBeUndefined()
  })

  it('rejects a missing or additional migration', () => {
    expect(() => assertMigrationBaseline(expectedMigrationBaseline().slice(1)))
      .toThrow('历史迁移数量漂移')
  })

  it('rejects migration order or name drift', () => {
    const actual = expectedMigrationBaseline()
    ;[actual[0], actual[1]] = [actual[1]!, actual[0]!]
    expect(() => assertMigrationBaseline(actual)).toThrow('历史迁移顺序或名称漂移')
  })

  it('rejects SQL content drift', () => {
    const actual = expectedMigrationBaseline()
    actual[0] = { ...actual[0]!, sha256: '0'.repeat(64) }
    expect(() => assertMigrationBaseline(actual)).toThrow('历史迁移内容漂移')
  })

  it('commits critical relations, columns, and unique indexes for live-schema validation', () => {
    expect(criticalSchemaFingerprint.relations).toContain('public.instance_jobs')
    expect(criticalSchemaFingerprint.columns).toContain('public.submissions.answer_digest:bytea')
    expect(criticalSchemaFingerprint.indexes).toContain('public.scoreboard_snapshots_scope_version_unique')
  })

  it('keeps the build-time migration manifest aligned with every SQL file', async () => {
    const { currentMigrationNames } = await import('./migration-baseline')
    expect(currentMigrationNames).toEqual((await loadMigrationFiles()).map(migration => migration.name))
  })
})
