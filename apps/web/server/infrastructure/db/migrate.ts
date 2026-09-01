import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { DatabaseClient } from './client'

export const defaultMigrationsFolder = fileURLToPath(
  new URL('../../../db/migrations', import.meta.url),
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
