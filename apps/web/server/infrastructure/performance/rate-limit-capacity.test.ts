import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createPostgresTestDatabase,
  runPostgresTestMigrations,
  type PostgresTestDatabase,
} from '../../test-support/postgres-database'
import { PostgresRateLimitStore } from '../security/postgres-rate-limit-store'

const adminDatabaseUrl = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminDatabaseUrl ? describe : describe.skip
const requestCount = 200
const connectionBudget = 40

describeWithPostgres('PostgreSQL rate limit capacity', () => {
  let admin: Sql
  let databaseName: string
  let database: PostgresTestDatabase

  beforeAll(async () => {
    admin = postgres(adminDatabaseUrl!, { max: 1, onnotice: () => {} })
    databaseName = `sauryctf_rate_capacity_${randomUUID().replaceAll('-', '')}`
    assertDatabaseName(databaseName)
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    const url = new URL(adminDatabaseUrl!)
    url.pathname = `/${databaseName}`
    database = createPostgresTestDatabase({
      connectionString: url.toString(),
      maxConnections: connectionBudget,
      applicationName: 'sauryctf-rate-limit-capacity',
    })
    await runPostgresTestMigrations(database)
  })

  afterAll(async () => {
    await database?.close()
    if (admin && databaseName) {
      await admin`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${databaseName} AND pid <> pg_backend_pid()`
      assertDatabaseName(databaseName)
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`)
    }
    await admin?.end()
  })

  it('sustains hotspot network, challenge, and 200 submission-per-second decisions', async () => {
    const store = new PostgresRateLimitStore(database.executor)
    const hotspotIp = `capacity-ip:${randomUUID()}`
    const hotspotChallenge = `capacity-challenge:${randomUUID()}`
    const network = await measure(Array.from({ length: requestCount }, () => () => (
      store.consume(hotspotIp, requestCount + 1, 60_000)
    )))
    const challenge = await measure(Array.from({ length: requestCount }, () => () => (
      store.consumeMany([
        { bucket: hotspotIp, limit: requestCount * 3, windowMs: 60_000 },
        { bucket: hotspotChallenge, limit: requestCount + 1, windowMs: 60_000 },
      ])
    )))
    const submissions = await measure(Array.from({ length: requestCount }, (_, index) => () => (
      store.consume(`submission:${index}:${randomUUID()}`, 1, 60_000)
    )))
    const databaseState = await database.executor.query<{
      connections: number
      waiting_locks: number
    }>(`
      SELECT
        (SELECT count(*)::integer FROM pg_stat_activity
         WHERE datname = current_database()
           AND application_name = 'sauryctf-rate-limit-capacity') AS connections,
        (SELECT count(*)::integer FROM pg_locks
         WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
           AND NOT granted) AS waiting_locks
    `)
    const evidence = {
      requestsPerScenario: requestCount,
      network,
      challenge,
      submissions,
      connections: databaseState.rows[0]?.connections ?? 0,
      waitingLocksAfterRun: databaseState.rows[0]?.waiting_locks ?? 0,
    }
    console.info(JSON.stringify({ rateLimitCapacity: evidence }))

    expect(network.p95Ms).toBeLessThan(1_000)
    expect(challenge.p95Ms).toBeLessThan(1_000)
    expect(submissions.elapsedMs).toBeLessThan(1_000)
    expect(evidence.connections).toBeLessThanOrEqual(connectionBudget)
    expect(evidence.waitingLocksAfterRun).toBe(0)
  }, 30_000)
})

async function measure(operations: Array<() => Promise<unknown>>) {
  const startedAt = performance.now()
  const latencies = await Promise.all(operations.map(async (operation) => {
    const operationStartedAt = performance.now()
    await operation()
    return performance.now() - operationStartedAt
  }))
  latencies.sort((left, right) => left - right)
  return {
    elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
    p95Ms: Math.round(latencies[Math.ceil(latencies.length * 0.95) - 1]! * 100) / 100,
  }
}

function assertDatabaseName(name: string): void {
  if (!/^sauryctf_rate_capacity_[a-f0-9]{32}$/u.test(name)) {
    throw new Error('Refusing to operate on an unexpected test database name')
  }
}
