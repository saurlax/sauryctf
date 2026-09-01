import type { Pool } from 'pg'
import type {
  ClaimedMailDelivery,
  MailOutboxRepository,
} from '../../domains/notifications/mail-outbox'

export class PostgresMailOutboxRepository implements MailOutboxRepository {
  constructor(private readonly pool: Pool) {}

  async claim(workerId: string, claimedAt: Date, leaseUntil: Date, limit: number): Promise<ClaimedMailDelivery[]> {
    const result = await this.pool.query<{
      id: string
      recipient: string
      template_key: string
      payload: Record<string, unknown>
      attempt_count: number
      max_attempts: number
    }>(
      `WITH candidates AS (
         SELECT id
         FROM mail_deliveries
         WHERE attempt_count < max_attempts
           AND (
             (status IN ('pending', 'retry_wait') AND available_at <= $2)
             OR (status = 'leased' AND lease_until <= $2)
           )
         ORDER BY available_at, created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $4
       )
       UPDATE mail_deliveries AS delivery
       SET status = 'leased',
           lease_owner = $1,
           lease_until = $3,
           attempt_count = delivery.attempt_count + 1,
           updated_at = $2
       FROM candidates
       WHERE delivery.id = candidates.id
       RETURNING delivery.id, delivery.recipient, delivery.template_key,
                 delivery.payload, delivery.attempt_count, delivery.max_attempts`,
      [workerId, claimedAt, leaseUntil, limit],
    )
    return result.rows.map(row => ({
      id: row.id,
      recipient: row.recipient,
      templateKey: row.template_key,
      payload: row.payload,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
    }))
  }

  async markSent(deliveryId: string, workerId: string, sentAt: Date): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE mail_deliveries
       SET status = 'sent', sent_at = $3, lease_owner = NULL, lease_until = NULL,
           last_error = NULL, updated_at = $3
       WHERE id = $1 AND status = 'leased' AND lease_owner = $2`,
      [deliveryId, workerId, sentAt],
    )
    return result.rowCount === 1
  }

  async markFailed(
    deliveryId: string,
    workerId: string,
    failedAt: Date,
    retryAt: Date,
    terminal: boolean,
    errorCode: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE mail_deliveries
       SET status = CASE WHEN $4 THEN 'failed'::mail_delivery_status ELSE 'retry_wait'::mail_delivery_status END,
           available_at = CASE WHEN $4 THEN available_at ELSE $5 END,
           lease_owner = NULL,
           lease_until = NULL,
           last_error = $6,
           updated_at = $3
       WHERE id = $1 AND status = 'leased' AND lease_owner = $2`,
      [deliveryId, workerId, failedAt, terminal, retryAt, errorCode],
    )
    return result.rowCount === 1
  }
}
