import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PgQueryResultHKT, PgTransactionConfig } from 'drizzle-orm/pg-core/session'
import type { TablesRelationalConfig } from 'drizzle-orm/relations'
import { sql, type SQL, type SQLChunk } from 'drizzle-orm/sql'

export interface DatabaseQueryResult<Row> {
  rows: Row[]
  rowCount: number
}

export interface DatabaseExecutor {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<DatabaseQueryResult<Row>>
  transaction<T>(
    work: (transaction: DatabaseExecutor) => Promise<T>,
    config?: DatabaseTransactionConfig,
  ): Promise<T>
}

export type DatabaseTransactionConfig = PgTransactionConfig

export class DatabaseQueryError extends Error {
  readonly code?: string
  readonly constraint?: string

  constructor(error: unknown) {
    super('PostgreSQL query failed')
    this.name = 'DatabaseQueryError'

    const postgresError = findPostgresDriverError(error) ?? error
    const code = safePostgresCode(postgresError)
    const constraint = safePostgresIdentifier(postgresErrorField(postgresError, 'constraint_name'))
      ?? safePostgresIdentifier(postgresErrorField(postgresError, 'constraint'))
    if (code) this.code = code
    if (constraint) this.constraint = constraint
  }
}

export function createDatabaseExecutor<
  TQueryResult extends PgQueryResultHKT,
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(database: PgDatabase<TQueryResult, TFullSchema, TSchema>): DatabaseExecutor {
  return createExecutor(database, false)
}

function createExecutor<
  TQueryResult extends PgQueryResultHKT,
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(
  database: PgDatabase<TQueryResult, TFullSchema, TSchema>,
  nested: boolean,
): DatabaseExecutor {
  return {
    async query<Row>(text: string, values: readonly unknown[] = []) {
      try {
        const result = await database.execute(bindSqlParameters(text, values))
        if (Array.isArray(result)) {
          const count = (result as { count?: unknown }).count
          return {
            rows: normalizePostgresJsRows(result) as Row[],
            rowCount: typeof count === 'number' ? count : result.length,
          }
        }
        if (isNodePostgresResult(result)) {
          return {
            rows: normalizeDatabaseRows(result.rows, result.fields) as Row[],
            rowCount: result.rowCount ?? result.rows.length,
          }
        }
        throw new TypeError('PostgreSQL driver returned an invalid query result')
      }
      catch (error) {
        throw mapDatabaseQueryError(error)
      }
    },
    async transaction<T>(
      work: (transaction: DatabaseExecutor) => Promise<T>,
      config?: DatabaseTransactionConfig,
    ): Promise<T> {
      if (nested && config) {
        throw new TypeError('Nested database transactions cannot change transaction configuration')
      }
      try {
        return await database.transaction(
          transaction => work(createExecutor(transaction, true)),
          config,
        )
      }
      catch (error) {
        if (isPostgresDriverError(error)) throw mapDatabaseQueryError(error)
        throw error
      }
    },
  }
}

export function bindSqlParameters(text: string, values: readonly unknown[] = []): SQL {
  const chunks: SQLChunk[] = []
  const usedParameters = new Set<number>()
  let rawStart = 0
  let index = 0

  while (index < text.length) {
    const character = text[index]!
    const next = text[index + 1]

    if (character === '\'') {
      index = skipQuoted(text, index, '\'')
      continue
    }
    if (character === '"') {
      index = skipQuoted(text, index, '"')
      continue
    }
    if (character === '-' && next === '-') {
      index = skipLineComment(text, index)
      continue
    }
    if (character === '/' && next === '*') {
      index = skipBlockComment(text, index)
      continue
    }
    if (character !== '$') {
      index += 1
      continue
    }

    const dollarQuote = readDollarQuoteDelimiter(text, index)
    if (dollarQuote) {
      index = skipDollarQuoted(text, index, dollarQuote)
      continue
    }

    const placeholder = /^\$(\d+)/u.exec(text.slice(index))
    if (!placeholder) {
      index += 1
      continue
    }
    const parameterNumber = Number(placeholder[1])
    if (!Number.isSafeInteger(parameterNumber) || parameterNumber < 1 || parameterNumber > values.length) {
      throw new TypeError(`SQL placeholder $${placeholder[1]} has no bound value`)
    }
    if (rawStart < index) chunks.push(sql.raw(text.slice(rawStart, index)))
    chunks.push(sql.param(normalizeBoundValue(values[parameterNumber - 1])))
    usedParameters.add(parameterNumber)
    index += placeholder[0].length
    rawStart = index
  }

  if (rawStart < text.length) chunks.push(sql.raw(text.slice(rawStart)))
  if (usedParameters.size !== values.length) {
    const unused = values.findIndex((_, valueIndex) => !usedParameters.has(valueIndex + 1)) + 1
    throw new TypeError(`SQL value $${unused} is not referenced by the query`)
  }
  return sql.join(chunks)
}

export function normalizeBoundValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (isPlainObject(value)) return JSON.stringify(value)
  return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function skipQuoted(text: string, start: number, quote: '\'' | '"'): number {
  let index = start + 1
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2
      continue
    }
    if (text[index] !== quote) {
      index += 1
      continue
    }
    if (text[index + 1] === quote) {
      index += 2
      continue
    }
    return index + 1
  }
  return text.length
}

function skipLineComment(text: string, start: number): number {
  const newline = text.indexOf('\n', start + 2)
  return newline === -1 ? text.length : newline + 1
}

function skipBlockComment(text: string, start: number): number {
  let depth = 1
  let index = start + 2
  while (index < text.length && depth > 0) {
    if (text[index] === '/' && text[index + 1] === '*') {
      depth += 1
      index += 2
    }
    else if (text[index] === '*' && text[index + 1] === '/') {
      depth -= 1
      index += 2
    }
    else {
      index += 1
    }
  }
  return index
}

function readDollarQuoteDelimiter(text: string, start: number): string | null {
  const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(text.slice(start))
  return match?.[0] ?? null
}

function skipDollarQuoted(text: string, start: number, delimiter: string): number {
  const end = text.indexOf(delimiter, start + delimiter.length)
  return end === -1 ? text.length : end + delimiter.length
}

function mapDatabaseQueryError(error: unknown): DatabaseQueryError {
  return error instanceof DatabaseQueryError ? error : new DatabaseQueryError(error)
}

function isPostgresDriverError(error: unknown): boolean {
  return findPostgresDriverError(error) !== undefined
}

function findPostgresDriverError(error: unknown): unknown | undefined {
  let candidate = error
  const visited = new Set<unknown>()
  for (let depth = 0; depth < 4 && candidate && !visited.has(candidate); depth += 1) {
    visited.add(candidate)
    if (postgresErrorField(candidate, 'name') === 'PostgresError'
      || safePostgresCode(candidate) !== undefined) return candidate
    candidate = postgresErrorField(candidate, 'cause')
  }
  return undefined
}

function safePostgresCode(error: unknown): string | undefined {
  const code = postgresErrorField(error, 'code')
  return typeof code === 'string' && /^[0-9A-Z]{5}$/u.test(code) ? code : undefined
}

function safePostgresIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_$]{0,127}$/u.test(value)
    ? value
    : undefined
}

function postgresErrorField(error: unknown, field: string): unknown {
  return typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>)[field]
    : undefined
}

function isNodePostgresResult(value: unknown): value is {
  rows: unknown[]
  rowCount: number | null
  fields?: unknown[]
} {
  return typeof value === 'object' && value !== null
    && Array.isArray((value as { rows?: unknown }).rows)
    && ((value as { rowCount?: unknown }).rowCount === null
      || typeof (value as { rowCount?: unknown }).rowCount === 'number')
}

interface PostgresJsColumn {
  name?: unknown
  type?: unknown
  dataTypeID?: unknown
}

function normalizePostgresJsRows(result: unknown[]): unknown[] {
  const columns = (result as { columns?: unknown }).columns
  return normalizeDatabaseRows(result, Array.isArray(columns) ? columns : undefined)
}

function normalizeDatabaseRows(result: unknown[], columns: unknown[] | undefined): unknown[] {
  if (!columns?.length) return Array.from(result)

  const typedColumns = columns.filter((column): column is PostgresJsColumn => (
    typeof column === 'object' && column !== null
  ))
  return result.map((row) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return row
    const normalized = { ...row } as Record<string, unknown>
    for (const column of typedColumns) {
      const type = typeof column.type === 'number' ? column.type : column.dataTypeID
      if (typeof column.name !== 'string' || typeof type !== 'number') continue
      const value = normalized[column.name]
      if (value === null || value === undefined) continue
      if (type === 17 && value instanceof Uint8Array && !Buffer.isBuffer(value)) {
        normalized[column.name] = Buffer.from(value)
      }
      else if ((type === 1082 || type === 1114 || type === 1184)
        && typeof value === 'string') {
        normalized[column.name] = parsePostgresDate(value, type)
      }
    }
    return normalized
  })
}

function parsePostgresDate(value: string, type: number): Date {
  const normalized = type === 1114
    ? value.replace(' ', 'T')
    : value
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.valueOf()) ? new Date(Number.NaN) : parsed
}
