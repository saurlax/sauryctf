import { createDatabaseClient } from './client'
import { runMigrations } from './migrate'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is required to run PostgreSQL migrations')
}

const client = createDatabaseClient({
  connectionString,
  applicationName: 'sauryctf-migrator',
  maxConnections: 2,
})

try {
  await runMigrations(client)
  console.log('PostgreSQL migrations completed.')
} finally {
  await client.pool.end()
}
