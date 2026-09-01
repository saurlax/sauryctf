import { z } from 'zod'

const safePositiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

export const domainEventSchema = z.strictObject({
  schema: z.literal('domain-event.v1'),
  id: z.uuid(),
  aggregateType: z.string().min(1).max(64),
  aggregateId: z.uuid(),
  eventType: z.string().min(1).max(128),
  eventVersion: safePositiveInteger,
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.iso.datetime({ offset: false, precision: 3 }),
})

export type DomainEvent = z.infer<typeof domainEventSchema>

export interface ClaimedDomainEvent extends DomainEvent {
  attemptCount: number
}

export interface DomainOutboxRepository {
  claim(claimedAt: Date, leaseUntil: Date, limit: number): Promise<ClaimedDomainEvent[]>
  markPublished(eventId: string, attemptCount: number, publishedAt: Date): Promise<boolean>
  markFailed(
    eventId: string,
    attemptCount: number,
    retryAt: Date,
    errorCode: string,
  ): Promise<boolean>
}

export type DomainEventPublishResult = 'published' | 'duplicate'

export interface DomainEventPublisher {
  publish(event: DomainEvent): Promise<DomainEventPublishResult>
}

export class DomainOutboxDispatcher {
  constructor(
    private readonly repository: DomainOutboxRepository,
    private readonly publisher: DomainEventPublisher,
    private readonly now: () => Date = () => new Date(),
    private readonly leaseMs = 30_000,
  ) {}

  async runOnce(limit = 50): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('Domain outbox batch limit must be between 1 and 100')
    }
    const claimedAt = this.now()
    requireValidDate(claimedAt)
    const events = await this.repository.claim(
      claimedAt,
      new Date(claimedAt.getTime() + this.leaseMs),
      limit,
    )
    await Promise.all(events.map(event => this.dispatch(event)))
    return events.length
  }

  private async dispatch(event: ClaimedDomainEvent): Promise<void> {
    try {
      const { attemptCount, ...domainEvent } = event
      await this.publisher.publish(domainEvent)
      await this.repository.markPublished(event.id, event.attemptCount, this.now())
    }
    catch (error) {
      const retryAt = new Date(this.now().getTime() + retryDelayMs(event.attemptCount))
      await this.repository.markFailed(
        event.id,
        event.attemptCount,
        retryAt,
        error instanceof Error ? error.name.slice(0, 120) : 'UnknownError',
      )
    }
  }
}

export function serializeDomainEvent(event: DomainEvent): string {
  return JSON.stringify(domainEventSchema.parse(event))
}

export function scoreboardVersionChange(event: DomainEvent): {
  contestId: string
  version: number
} | null {
  if (event.eventType !== 'scoreboard.version_changed') return null
  const payload = z.object({
    contest_id: z.uuid(),
    version: safePositiveInteger,
  }).safeParse(event.payload)
  if (!payload.success || payload.data.contest_id !== event.aggregateId) {
    throw new TypeError('Invalid scoreboard.version_changed payload')
  }
  return {
    contestId: payload.data.contest_id,
    version: payload.data.version,
  }
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(5 * 60_000, 1_000 * 2 ** Math.max(0, attemptCount - 1))
}

function requireValidDate(value: Date) {
  if (!Number.isFinite(value.getTime())) throw new RangeError('Domain outbox time is invalid')
}
