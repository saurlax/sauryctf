import postgres, { type TransactionSql } from 'postgres'
import type {
  LiveSchemaFingerprint,
  MigrationTakeoverDatabase,
  MigrationTakeoverTransaction,
} from './takeover'

export type PostgresTakeoverDatabase = MigrationTakeoverDatabase & {
  close(): Promise<void>
}

export function createPostgresTakeoverDatabase(databaseUrl: string): PostgresTakeoverDatabase {
  const sql = postgres(databaseUrl, {
    max: 1,
    connection: { application_name: 'sauryctf-migration-takeover' },
    onnotice: () => {},
  })
  return {
    transaction: async work => await sql.begin(
      transaction => work(new PostgresTakeoverTransaction(transaction)),
    ) as unknown as Awaited<ReturnType<typeof work>>,
    close: () => sql.end(),
  }
}

class PostgresTakeoverTransaction implements MigrationTakeoverTransaction {
  constructor(private readonly sql: TransactionSql) {}

  async readLegacyJournal() {
    const [relation] = await this.sql<{ name: string | null }[]>`
      SELECT to_regclass('control_plane.__drizzle_migrations')::text AS name
    `
    if (!relation?.name) return null
    const rows = await this.sql<{ hash: string, created_at: string }[]>`
      SELECT hash, created_at::text AS created_at
      FROM control_plane.__drizzle_migrations
      ORDER BY created_at, id
    `
    return rows.map(row => ({ hash: row.hash, createdAt: Number(row.created_at) }))
  }

  async readHubJournal() {
    const [relation] = await this.sql<{ name: string | null }[]>`
      SELECT to_regclass('public._hub_migrations')::text AS name
    `
    if (!relation?.name) return null
    const rows = await this.sql<{ name: string }[]>`
      SELECT name FROM public._hub_migrations ORDER BY id
    `
    return rows.map(row => row.name)
  }

  async readSchemaFingerprint(): Promise<LiveSchemaFingerprint> {
    const relations = await this.sql<{ value: string }[]>`
      SELECT n.nspname || '.' || c.relname AS value
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('control_plane', 'public') AND c.relkind IN ('r', 'p')
      ORDER BY value
    `
    const columns = await this.sql<{ value: string }[]>`
      SELECT table_schema || '.' || table_name || '.' || column_name || ':' || data_type AS value
      FROM information_schema.columns
      WHERE table_schema IN ('control_plane', 'public')
      ORDER BY value
    `
    const indexes = await this.sql<{ value: string }[]>`
      SELECT schemaname || '.' || indexname AS value
      FROM pg_indexes
      WHERE schemaname IN ('control_plane', 'public')
      ORDER BY value
    `
    return {
      relations: relations.map(row => row.value),
      columns: columns.map(row => row.value),
      indexes: indexes.map(row => row.value),
    }
  }

  async hasApplicationRelations(): Promise<boolean> {
    const [row] = await this.sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('control_plane', 'public')
        AND c.relkind IN ('r', 'p')
        AND c.relname <> '_hub_migrations'
    `
    return Number(row?.count ?? 0) > 0
  }

  async createHubJournal(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS public._hub_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `
  }

  async insertHubMigration(name: string): Promise<void> {
    await this.sql`
      INSERT INTO public._hub_migrations (name)
      VALUES (${name})
      ON CONFLICT (name) DO NOTHING
    `
  }
}
