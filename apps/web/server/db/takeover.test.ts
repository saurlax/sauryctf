import { describe, expect, it } from 'vitest'
import {
  criticalSchemaFingerprint,
  expectedMigrationBaseline,
} from './migration-baseline'
import {
  takeOverLegacyDrizzleJournal,
  type LegacyMigrationRow,
  type LiveSchemaFingerprint,
  type MigrationTakeoverDatabase,
  type MigrationTakeoverTransaction,
} from './takeover'

describe('legacy Drizzle journal takeover', () => {
  it('claims every verified migration and is idempotent', async () => {
    const database = fakeDatabase()
    await expect(takeOverLegacyDrizzleJournal(database, { verifyFiles: verifiedFiles }))
      .resolves.toEqual({ state: 'claimed', migrations: 22 })
    await expect(takeOverLegacyDrizzleJournal(database, { verifyFiles: verifiedFiles }))
      .resolves.toEqual({ state: 'already-claimed', migrations: 22 })
    expect(database.state.hub).toEqual(expectedMigrationBaseline().map(entry => entry.name))
  })

  it('leaves an empty database untouched for normal NuxtHub migration', async () => {
    const database = fakeDatabase({ legacy: null, hasApplicationRelations: false })
    await expect(takeOverLegacyDrizzleJournal(database, { verifyFiles: verifiedFiles }))
      .resolves.toEqual({ state: 'empty', migrations: 0 })
    expect(database.state.hub).toBeNull()
  })

  it('rejects a missing legacy migration before creating the NuxtHub journal', async () => {
    const database = fakeDatabase({ legacy: legacyRows().slice(1) })
    await expect(takeOverLegacyDrizzleJournal(database, { verifyFiles: verifiedFiles }))
      .rejects.toThrow('迁移数量不匹配')
    expect(database.state.hub).toBeNull()
  })

  it('rejects a legacy hash mismatch before creating the NuxtHub journal', async () => {
    const legacy = legacyRows()
    legacy[4] = { ...legacy[4]!, hash: '0'.repeat(64) }
    const database = fakeDatabase({ legacy })
    await expect(takeOverLegacyDrizzleJournal(database, { verifyFiles: verifiedFiles }))
      .rejects.toThrow('journal hash 不匹配')
    expect(database.state.hub).toBeNull()
  })

  it('rejects unknown populated schemas', async () => {
    const database = fakeDatabase({ legacy: null, hasApplicationRelations: true })
    await expect(takeOverLegacyDrizzleJournal(database, { verifyFiles: verifiedFiles }))
      .rejects.toThrow('未知 schema')
  })

  it('rolls back every inserted journal row when the transaction fails', async () => {
    const database = fakeDatabase({ failInsertAt: 3 })
    await expect(takeOverLegacyDrizzleJournal(database, { verifyFiles: verifiedFiles }))
      .rejects.toThrow('simulated insert failure')
    expect(database.state.hub).toBeNull()
  })
})

const verifiedFiles = async () => undefined

function legacyRows(): LegacyMigrationRow[] {
  return expectedMigrationBaseline().map(entry => ({
    hash: entry.sha256,
    createdAt: entry.legacyCreatedAt,
  }))
}

function fakeDatabase(overrides: {
  legacy?: LegacyMigrationRow[] | null
  schema?: LiveSchemaFingerprint
  hasApplicationRelations?: boolean
  failInsertAt?: number
} = {}): MigrationTakeoverDatabase & { state: { hub: string[] | null } } {
  const state = { hub: null as string[] | null }
  return {
    state,
    async transaction(work) {
      const transactionState = { hub: state.hub ? [...state.hub] : null }
      let inserts = 0
      const transaction: MigrationTakeoverTransaction = {
        readLegacyJournal: async () => overrides.legacy === undefined ? legacyRows() : overrides.legacy,
        readHubJournal: async () => transactionState.hub ? [...transactionState.hub] : null,
        readSchemaFingerprint: async () => overrides.schema ?? criticalSchemaFingerprint,
        hasApplicationRelations: async () => overrides.hasApplicationRelations ?? true,
        createHubJournal: async () => { transactionState.hub ??= [] },
        insertHubMigration: async (name) => {
          inserts += 1
          if (inserts === overrides.failInsertAt) throw new Error('simulated insert failure')
          transactionState.hub!.push(name)
        },
      }
      const result = await work(transaction)
      state.hub = transactionState.hub
      return result
    },
  }
}
