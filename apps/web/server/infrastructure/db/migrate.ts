import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { DatabaseClient } from './client'

// Transitional test helper. Production migration entrypoints use server/db/migrate.ts.
export const defaultMigrationsFolder = fileURLToPath(
  new URL('../../db/migrations/postgresql', import.meta.url),
)

export async function runMigrations(
  client: DatabaseClient,
  migrationsFolder = defaultMigrationsFolder,
): Promise<void> {
  await migrate(client.db, {
    migrationsFolder,
    migrationsSchema: 'control_plane',
    migrationsTable: '__drizzle_migrations',
  })
}
