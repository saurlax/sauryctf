import type { Pool } from 'pg'
import {
  domainEventSchema,
  type ClaimedDomainEvent,
  type DomainOutboxRepository,
} from '../../domains/events/domain-outbox'

interface DomainOutboxRow {
  id: string
  aggregate_type: string
  aggregate_id: string
  event_type: string
  event_version: number
  payload: unknown
  occurred_at: Date
  attempt_count: number
}

export class PostgresDomainOutboxRepository implements DomainOutboxRepository {
  constructor(private readonly pool: Pool) {}

  async claim(claimedAt: Date, leaseUntil: Date, limit: number): Promise<ClaimedDomainEvent[]> {
    const result = await this.pool.query<DomainOutboxRow>(
      `WITH candidates AS (
         SELECT id
         FROM domain_outbox
         WHERE published_at IS NULL AND available_at <= $1
         ORDER BY occurred_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $3
       )
       UPDATE domain_outbox AS event
       SET attempt_count = event.attempt_count + 1,
           available_at = $2,
           last_error = NULL
       FROM candidates
       WHERE event.id = candidates.id
       RETURNING event.id, event.aggregate_type, event.aggregate_id,
                 event.event_type, event.event_version, event.payload,
                 event.occurred_at, event.attempt_count`,
      [claimedAt, leaseUntil, limit],
    )
    return result.rows.map(claimedEvent)
  }

  async markPublished(eventId: string, attemptCount: number, publishedAt: Date): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE domain_outbox
       SET published_at = $3, available_at = $3, last_error = NULL
       WHERE id = $1 AND published_at IS NULL AND attempt_count = $2`,
      [eventId, attemptCount, publishedAt],
    )
    return result.rowCount === 1
  }

  async markFailed(
    eventId: string,
    attemptCount: number,
    retryAt: Date,
    errorCode: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE domain_outbox
       SET available_at = $3, last_error = $4
       WHERE id = $1 AND published_at IS NULL AND attempt_count = $2`,
      [eventId, attemptCount, retryAt, errorCode],
    )
    return result.rowCount === 1
  }
}

function claimedEvent(row: DomainOutboxRow): ClaimedDomainEvent {
  if (!Number.isSafeInteger(row.attempt_count) || row.attempt_count < 1) {
    throw new RangeError('Domain outbox attempt count is invalid')
  }
  const event = domainEventSchema.parse({
    schema: 'domain-event.v1',
    id: row.id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    payload: row.payload,
    occurredAt: row.occurred_at.toISOString(),
  })
  return { ...event, attemptCount: row.attempt_count }
}
