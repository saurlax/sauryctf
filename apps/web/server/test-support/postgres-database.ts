import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import * as schema from '../db/schema'
import { runNuxtHubMigrations } from '../db/migrate'
import {
  createDatabaseExecutor,
  bindSqlParameters,
  DatabaseQueryError,
  normalizeBoundValue,
  type DatabaseExecutor,
  type DatabaseTransactionConfig,
} from '../infrastructure/db/executor'

export interface PostgresTestDatabase {
  db: PostgresJsDatabase<typeof schema>
  executor: DatabaseExecutor
  connectionString: string
  connect(): Promise<PostgresTestConnection>
  close(): Promise<void>
}

export interface PostgresTestConnection extends DatabaseExecutor {
  release(): void
}

export interface PostgresTestDatabaseOptions {
  connectionString: string
  maxConnections?: number
  applicationName?: string
  connectionTimeoutMs?: number
}

export function createPostgresTestDatabase(
  options: PostgresTestDatabaseOptions,
): PostgresTestDatabase {
  const client = postgres(options.connectionString, {
    max: options.maxConnections ?? 4,
    connection: {
      application_name: options.applicationName ?? 'sauryctf-integration-test',
    },
    connect_timeout: options.connectionTimeoutMs
      ? Math.ceil(options.connectionTimeoutMs / 1000)
      : undefined,
    onnotice: () => {},
  })
  const db = drizzle({ client, schema })
  let closed = false

  return {
    db,
    executor: createDatabaseExecutor(db),
    connectionString: options.connectionString,
    async connect() {
      const reserved = await client.reserve()
      const executor = createRawPostgresExecutor(reserved, reserved)
      let released = false
      return {
        ...executor,
        release() {
          if (released) return
          released = true
          reserved.release()
        },
      }
    },
    async close() {
      if (closed) return
      closed = true
      await client.end()
    },
  }
}

type UnsafePostgresClient = Pick<Sql, 'unsafe'>

function createRawPostgresExecutor(
  client: UnsafePostgresClient,
  transactionOwner?: Sql,
): DatabaseExecutor {
  return {
    async query<Row>(text: string, values: readonly unknown[] = []) {
      bindSqlParameters(text, values)
      try {
        const rows = await client.unsafe(text, values.map(normalizeBoundValue) as never[])
        return {
          rows: Array.from(rows) as Row[],
          rowCount: rows.count,
        }
      }
      catch (error) {
        throw new DatabaseQueryError(error)
      }
    },
    async transaction<T>(
      work: (transaction: DatabaseExecutor) => Promise<T>,
      config?: DatabaseTransactionConfig,
    ) {
      if (!transactionOwner) throw new TypeError('Nested test transactions are not supported')
      const options = transactionOptions(config)
      const result = options
        ? await transactionOwner.begin(options, transaction => work(createRawPostgresExecutor(transaction)))
        : await transactionOwner.begin(transaction => work(createRawPostgresExecutor(transaction)))
      return result as T
    },
  }
}

function transactionOptions(config: DatabaseTransactionConfig | undefined): string {
  if (!config) return ''
  const options: string[] = []
  if (config.isolationLevel) options.push(`isolation level ${config.isolationLevel}`)
  if (config.accessMode) options.push(config.accessMode)
  if (config.deferrable !== undefined) options.push(config.deferrable ? 'deferrable' : 'not deferrable')
  return options.join(' ')
}

export async function runPostgresTestMigrations(database: PostgresTestDatabase): Promise<void> {
  await runNuxtHubMigrations({ databaseUrl: database.connectionString })
}

export class PostgresTestClient {
  readonly #database: PostgresTestDatabase

  constructor(options: {
    connectionString?: string
    application_name?: string
    max?: number
  }) {
    if (!options.connectionString) throw new Error('TEST_DATABASE_ADMIN_URL is required')
    this.#database = createPostgresTestDatabase({
      connectionString: options.connectionString,
      maxConnections: options.max ?? 1,
      applicationName: options.application_name ?? 'sauryctf-integration-test-admin',
    })
  }

  async connect(): Promise<void> {}

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ) {
    return this.#database.executor.query<Row>(text, values)
  }

  end(): Promise<void> {
    return this.#database.close()
  }
}
