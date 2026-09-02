import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../../db/schema'
import { createDatabaseExecutor } from '../db/executor'
import { NuxtHubBlobStorageFactory } from './blob-storage'
import { loadCommittedBlobManifest, migrateCommittedBlobs } from './blob-migration'
import { parseBlobMigrationBackend } from './blob-migration-config'
import { NuxtHubContentObjectStore } from './nuxthub-content-object-store'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required for Blob migration')

const client = postgres(databaseUrl, { max: 1, onnotice: () => {} })
try {
  const database = createDatabaseExecutor(drizzle({ client, schema }))
  const source = new NuxtHubContentObjectStore(await new NuxtHubBlobStorageFactory(
    parseBlobMigrationBackend(process.env, 'SOURCE'),
  ).get())
  const target = new NuxtHubContentObjectStore(await new NuxtHubBlobStorageFactory(
    parseBlobMigrationBackend(process.env, 'TARGET'),
  ).get())
  const manifest = await loadCommittedBlobManifest(database)
  const result = await migrateCommittedBlobs(manifest, source, target)
  console.log(`Blob migration verified (${result.copied} copied, ${result.skipped} already present, ${result.total} total). Target is ready to switch.`)
}
catch {
  console.error('Blob migration failed; the active backend must not be switched.')
  process.exitCode = 1
}
finally {
  await client.end()
}
