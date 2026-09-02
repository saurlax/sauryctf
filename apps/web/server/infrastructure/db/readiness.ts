import type { QueryResult, QueryResultRow } from 'pg'
import { currentMigrationNames, expectedMigrationBaseline } from '../../db/migration-baseline'
import { assertLegacyJournal, type LegacyMigrationRow } from '../../db/takeover'

interface MigrationTablesRow extends QueryResultRow {
  hub_journal: string | null
  legacy_journal: string | null
}

interface HubMigrationRow extends QueryResultRow {
  name: string
}

interface LegacyMigrationStateRow extends QueryResultRow {
  hash: string
  created_at: string
}

interface ReadinessDatabase {
  query<Row extends QueryResultRow>(text: string): Promise<QueryResult<Row>>
}

export class PostgresControlPlaneReadiness {
  constructor(private readonly pool: ReadinessDatabase) {
    if (currentMigrationNames.length < 1) throw new Error('Control-plane migration manifest is empty')
  }

  async ready(): Promise<void> {
    let tables: QueryResult<MigrationTablesRow>
    try {
      tables = await this.pool.query<MigrationTablesRow>(`
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

    let hubMigrations: QueryResult<HubMigrationRow>
    try {
      hubMigrations = await this.pool.query<HubMigrationRow>(
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
    let legacyRows: QueryResult<LegacyMigrationStateRow>
    try {
      legacyRows = await this.pool.query<LegacyMigrationStateRow>(`
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
