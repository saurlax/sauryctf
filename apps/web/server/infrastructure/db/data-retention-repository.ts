import type {
  SecurityLogEventInput,
  SecurityLogWriter,
} from '../../domains/administration/security-logs'
import type {
  DataRetentionRepository,
  RetentionBatchResult,
} from '../../jobs/data-retention'
import type { DatabaseExecutor } from './executor'

export class PostgresDataRetentionRepository implements DataRetentionRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async purgeExpired(input: {
    auditBefore: Date
    securityBefore: Date
    limit: number
  }): Promise<RetentionBatchResult> {
    return this.database.transaction(async (transaction) => {
      const result = await transaction.query<{
        audit_deleted: number
        security_logs_deleted: number
      }>(`
        SELECT audit_deleted, security_logs_deleted
        FROM apply_data_retention($1, $2, $3)`, [
        input.auditBefore,
        input.securityBefore,
        input.limit,
      ])
      const row = result.rows[0]
      if (!row) throw new Error('Retention function returned no result')
      const expiredWindows = await transaction.query<{ count: number }>(`
        WITH candidates AS (
          SELECT bucket_digest, window_started_at
          FROM rate_limit_windows
          WHERE expires_at <= clock_timestamp()
          ORDER BY expires_at, window_started_at
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        ), deleted AS (
          DELETE FROM rate_limit_windows AS target
          USING candidates
          WHERE target.bucket_digest = candidates.bucket_digest
            AND target.window_started_at = candidates.window_started_at
          RETURNING target.bucket_digest
        )
        SELECT count(*)::integer AS count FROM deleted
      `, [input.limit])
      return {
        auditDeleted: row.audit_deleted,
        securityLogsDeleted: row.security_logs_deleted,
        rateLimitWindowsDeleted: expiredWindows.rows[0]?.count ?? 0,
      }
    })
  }
}

export class PostgresSecurityLogWriter implements SecurityLogWriter {
  constructor(private readonly database: DatabaseExecutor) {}

  async record(input: SecurityLogEventInput): Promise<void> {
    await this.database.query(`
      INSERT INTO security_log_events
        (event_type, severity, request_id, error_code, method, route,
         status_code, occurred_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
      input.eventType,
      input.severity,
      input.requestId,
      input.errorCode,
      input.method,
      input.route,
      input.statusCode,
      input.occurredAt,
    ])
  }
}
