import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool, type PoolConfig } from 'pg'
import * as schema from '../../db/schema'

export interface DatabaseClient {
  db: NodePgDatabase<typeof schema>
  pool: Pool
}

export interface DatabaseClientOptions {
  connectionString: string
  maxConnections?: number
  idleTimeoutMs?: number
  connectionTimeoutMs?: number
  applicationName?: string
}

export function createDatabaseClient(options: DatabaseClientOptions): DatabaseClient {
  const poolConfig: PoolConfig = {
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    idleTimeoutMillis: options.idleTimeoutMs ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    application_name: options.applicationName ?? 'sauryctf-control-plane',
  }
  const pool = new Pool(poolConfig)

  return {
    pool,
    db: drizzle(pool, { schema }),
  }
}
