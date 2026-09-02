import { currentMigrationNames, expectedMigrationBaseline } from '../../db/migration-baseline'
import { assertLegacyJournal, type LegacyMigrationRow } from '../../db/takeover'
import type { DatabaseExecutor, DatabaseQueryResult } from './executor'

interface MigrationTablesRow {
  hub_journal: string | null
  legacy_journal: string | null
}

interface HubMigrationRow {
  name: string
}

interface LegacyMigrationStateRow {
  hash: string
  created_at: string
}

type ReadinessDatabase = Pick<DatabaseExecutor, 'query'>

export class PostgresControlPlaneReadiness {
  constructor(private readonly database: ReadinessDatabase) {
    if (currentMigrationNames.length < 1) throw new Error('Control-plane migration manifest is empty')
  }

  async ready(): Promise<void> {
    let tables: DatabaseQueryResult<MigrationTablesRow>
    try {
      tables = await this.database.query<MigrationTablesRow>(`
        SELECT
          to_regclass('public._hub_migrations')::text AS hub_journal,
          to_regclass('control_plane.__drizzle_migrations')::text AS legacy_journal
      `)
    }
    catch (error) {
      throw new Error('Authoritative PostgreSQL database is unavailable', { cause: error })
    }

    const state = tables.rows[0]
    if (state?.hub_journal !== '_hub_migrations') {
      throw new Error('Control-plane NuxtHub migration journal is unavailable')
    }

    let hubMigrations: DatabaseQueryResult<HubMigrationRow>
    try {
      hubMigrations = await this.database.query<HubMigrationRow>(
        'SELECT name FROM public._hub_migrations ORDER BY id',
      )
    }
    catch (error) {
      throw new Error('Control-plane migration state cannot be read', { cause: error })
    }
    const actualNames = hubMigrations.rows.map(row => row.name)
    if (actualNames.length !== currentMigrationNames.length
      || actualNames.some((name, index) => name !== currentMigrationNames[index])) {
      throw new Error('Control-plane database migration version does not match this release')
    }

    if (state.legacy_journal) await this.assertLegacyJournalClaimed()
  }

  private async assertLegacyJournalClaimed(): Promise<void> {
    let legacyRows: DatabaseQueryResult<LegacyMigrationStateRow>
    try {
      legacyRows = await this.database.query<LegacyMigrationStateRow>(`
        SELECT hash, created_at::text AS created_at
        FROM control_plane.__drizzle_migrations
        ORDER BY created_at, id
      `)
    }
    catch (error) {
      throw new Error('Legacy migration takeover state cannot be read', { cause: error })
    }
    const legacy: LegacyMigrationRow[] = legacyRows.rows.map(row => ({
      hash: row.hash,
      createdAt: Number(row.created_at),
    }))
    try {
      assertLegacyJournal(legacy, expectedMigrationBaseline())
    }
    catch (error) {
      throw new Error('Legacy migration journal has not been safely claimed', { cause: error })
    }
  }
}
