import { runNuxtHubMigrations } from './migrate'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required to run PostgreSQL migrations')

try {
  const result = await runNuxtHubMigrations({ databaseUrl })
  console.log(`PostgreSQL migrations completed (${result.applied.length} applied, ${result.total} total).`)
}
catch (error) {
  console.error(error instanceof Error ? error.message : 'PostgreSQL migration failed')
  process.exitCode = 1
}
