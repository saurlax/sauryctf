import { randomUUID } from 'node:crypto'
import { createClient } from 'redis'
import { describe, expect, it } from 'vitest'
import type { DomainEvent } from '../../domains/events/domain-outbox'
import {
  RedisDomainEventPublisher,
  RedisDomainEventsUnavailableError,
  scoreboardVersionKey,
} from './redis-domain-event-publisher'

function scoreboardEvent(version: number): DomainEvent {
  const contestId = randomUUID()
  return {
    schema: 'domain-event.v1',
    id: randomUUID(),
    aggregateType: 'contest',
    aggregateId: contestId,
    eventType: 'scoreboard.version_changed',
    eventVersion: 1,
    payload: { contest_id: contestId, version },
    occurredAt: '2026-09-01T08:00:00.000Z',
  }
}

describe('disabled Redis domain event publisher', () => {
  it('retains the outbox event by reporting Redis as unavailable', async () => {
    const publisher = new RedisDomainEventPublisher()
    await expect(publisher.publish(scoreboardEvent(1)))
      .rejects.toBeInstanceOf(RedisDomainEventsUnavailableError)
    await publisher.close()
  })
})

const redisUrl = process.env.TEST_REDIS_URL
const describeWithRedis = redisUrl ? describe : describe.skip

describeWithRedis('Redis domain event publication', () => {
  it('deduplicates an event id atomically across publisher instances', async () => {
    const first = new RedisDomainEventPublisher(redisUrl)
    const second = new RedisDomainEventPublisher(redisUrl)
    const event = scoreboardEvent(4)
    try {
      const results = await Promise.all([first.publish(event), second.publish(event)])
      expect(results.toSorted()).toEqual(['duplicate', 'published'])
    }
    finally {
      await first.close()
      await second.close()
    }
  })

  it('advances the cache version marker monotonically', async () => {
    const publisher = new RedisDomainEventPublisher(redisUrl)
    const inspector = createClient({ url: redisUrl })
    const newer = scoreboardEvent(8)
    const older: DomainEvent = {
      ...scoreboardEvent(7),
      aggregateId: newer.aggregateId,
      payload: { contest_id: newer.aggregateId, version: 7 },
    }
    try {
      await inspector.connect()
      await publisher.publish(newer)
      await publisher.publish(older)
      await expect(inspector.get(scoreboardVersionKey(newer.aggregateId))).resolves.toBe('8')
    }
    finally {
      if (inspector.isOpen) inspector.destroy()
      await publisher.close()
    }
  })
})
