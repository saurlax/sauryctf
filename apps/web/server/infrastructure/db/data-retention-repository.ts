import type { Pool } from 'pg'
import type {
  SecurityLogEventInput,
  SecurityLogWriter,
} from '../../domains/administration/security-logs'
import type {
  DataRetentionRepository,
  RetentionBatchResult,
} from '../../jobs/data-retention'

export class PostgresDataRetentionRepository implements DataRetentionRepository {
  constructor(private readonly pool: Pool) {}

  async purgeExpired(input: {
    auditBefore: Date
    securityBefore: Date
    limit: number
  }): Promise<RetentionBatchResult> {
    const result = await this.pool.query<{
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
    return {
      auditDeleted: row.audit_deleted,
      securityLogsDeleted: row.security_logs_deleted,
    }
  }
}

export class PostgresSecurityLogWriter implements SecurityLogWriter {
  constructor(private readonly pool: Pool) {}

  async record(input: SecurityLogEventInput): Promise<void> {
    await this.pool.query(`
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
