import { createHash } from 'node:crypto'
import type { DatabaseExecutor } from '../db/executor'
import type {
  RateLimitDecision,
  RateLimitPolicy,
  RateLimitStore,
} from './rate-limit'

type ConsumedWindowRow = {
  ordinal: number
  limit: number
  request_count: number
  retry_after_ms: string | number
}

export class RateLimitStoreUnavailableError extends Error {
  constructor() {
    super('PostgreSQL rate limit store is unavailable')
    this.name = 'RateLimitStoreUnavailableError'
  }
}

export class PostgresRateLimitStore implements RateLimitStore {
  constructor(private readonly database: DatabaseExecutor) {}

  async consume(bucket: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    return (await this.consumeMany([{ bucket, limit, windowMs }]))[0]!
  }

  async consumeMany(policies: readonly RateLimitPolicy[]): Promise<RateLimitDecision[]> {
    if (policies.length === 0) return []
    const input = policies.map((policy, ordinal) => ({
      ordinal,
      digest: digestBucket(policy.bucket),
      limit: positiveInteger(policy.limit, 'limit'),
      windowMs: positiveInteger(policy.windowMs, 'windowMs'),
    }))
    const uniqueWindows = new Set(input.map(policy => `${policy.digest}:${policy.windowMs}`))
    if (uniqueWindows.size !== input.length) {
      throw new TypeError('Rate limit policies must use unique bucket and window pairs')
    }

    try {
      const result = await this.database.query<ConsumedWindowRow>(`
        WITH policy AS (
          SELECT
            (item->>'ordinal')::integer AS ordinal,
            decode(item->>'digest', 'hex') AS bucket_digest,
            (item->>'limit')::integer AS limit_value,
            (item->>'windowMs')::bigint AS window_ms
          FROM jsonb_array_elements($1::jsonb) AS item
        ), database_clock AS (
          SELECT clock_timestamp() AS now
        ), requested_window AS (
          SELECT
            policy.*,
            to_timestamp(
              floor(extract(epoch FROM database_clock.now) * 1000 / policy.window_ms)
              * policy.window_ms / 1000.0
            ) AS window_started_at
          FROM policy
          CROSS JOIN database_clock
        ), consumed AS (
          INSERT INTO rate_limit_windows (
            bucket_digest,
            window_started_at,
            expires_at,
            request_count
          )
          SELECT
            bucket_digest,
            window_started_at,
            window_started_at + window_ms * interval '1 millisecond',
            1
          FROM requested_window
          ON CONFLICT (bucket_digest, window_started_at) DO UPDATE
          SET request_count = rate_limit_windows.request_count + 1
          RETURNING bucket_digest, window_started_at, expires_at, request_count
        )
        SELECT
          requested_window.ordinal,
          requested_window.limit_value AS limit,
          consumed.request_count,
          greatest(
            1,
            ceil(extract(epoch FROM (consumed.expires_at - clock_timestamp())) * 1000)
          )::bigint AS retry_after_ms
        FROM requested_window
        JOIN consumed USING (bucket_digest, window_started_at)
        ORDER BY requested_window.ordinal
      `, [JSON.stringify(input)])
      if (result.rows.length !== policies.length) throw new Error('Incomplete rate limit result')
      return result.rows.map(row => ({
        allowed: row.request_count <= row.limit,
        limit: row.limit,
        remaining: Math.max(0, row.limit - row.request_count),
        retryAfterMs: Math.max(1, Number(row.retry_after_ms)),
      }))
    }
    catch (error) {
      if (error instanceof TypeError) throw error
      throw new RateLimitStoreUnavailableError()
    }
  }
}

function digestBucket(bucket: string): string {
  if (!bucket) throw new TypeError('Rate limit bucket must not be empty')
  return createHash('sha256').update(bucket, 'utf8').digest('hex')
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`Rate limit ${field} must be a positive integer`)
  }
  return value
}
