import type { QueryResult, QueryResultRow } from 'pg'
import migrationJournal from '../../../db/migrations/meta/_journal.json'

interface MigrationStateRow {
  migration_count: string
  latest_migration_at: string | null
}

interface MigrationTableRow {
  migration_table: string | null
}

interface ReadinessDatabase {
  query<Row extends QueryResultRow>(text: string): Promise<QueryResult<Row>>
}

const expectedMigrationCount = migrationJournal.entries.length
const expectedLatestMigrationAt = String(
  migrationJournal.entries.at(-1)?.when ?? 0,
)

export class PostgresControlPlaneReadiness {
  constructor(private readonly pool: ReadinessDatabase) {
    if (expectedMigrationCount < 1 || expectedLatestMigrationAt === '0') {
      throw new Error('Control-plane migration journal is empty')
    }
  }

  async ready(): Promise<void> {
    let migrationTable: { rows: MigrationTableRow[] }
    try {
      migrationTable = await this.pool.query<MigrationTableRow>(
        `SELECT to_regclass('control_plane.__drizzle_migrations')::text AS migration_table`,
      )
    }
    catch (error) {
      throw new Error('Authoritative PostgreSQL database is unavailable', { cause: error })
    }

    if (migrationTable.rows[0]?.migration_table !== 'control_plane.__drizzle_migrations') {
      throw new Error('Control-plane migration journal is unavailable')
    }

    let migrationState: { rows: MigrationStateRow[] }
    try {
      migrationState = await this.pool.query<MigrationStateRow>(
        `SELECT count(*)::text AS migration_count,
                max(created_at)::text AS latest_migration_at
         FROM control_plane.__drizzle_migrations`,
      )
    }
    catch (error) {
      throw new Error('Control-plane migration state cannot be read', { cause: error })
    }

    const state = migrationState.rows[0]
    if (state?.migration_count !== String(expectedMigrationCount)
      || state.latest_migration_at !== expectedLatestMigrationAt) {
      throw new Error('Control-plane database migration version does not match this release')
    }
  }
}
