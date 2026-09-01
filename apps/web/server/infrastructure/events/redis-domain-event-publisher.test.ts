import { randomUUID } from 'node:crypto'
import { createClient } from 'redis'
import { describe, expect, it } from 'vitest'
import type { DomainEvent } from '../../domains/events/domain-outbox'
import {
  contestRealtimeLogKey,
  domainEventChannel,
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

  it('stores one safe public refresh signal for a retried outbox event', async () => {
    const publisher = new RedisDomainEventPublisher(redisUrl)
    const inspector = createClient({ url: redisUrl })
    const subscriber = inspector.duplicate()
    const event = scoreboardEvent(11)
    event.payload = { ...event.payload, submitted_answer: 'flag{must-not-leak}' }
    try {
      await inspector.connect()
      await subscriber.connect()
      await inspector.del(contestRealtimeLogKey(event.aggregateId))
      let receiveInternal!: (message: string) => void
      const internalMessage = new Promise<string>((resolve) => { receiveInternal = resolve })
      await subscriber.subscribe(domainEventChannel, receiveInternal)
      await publisher.publish(event)
      await publisher.publish(event)

      const messages = await inspector.lRange(contestRealtimeLogKey(event.aggregateId), 0, -1)
      expect(messages).toHaveLength(1)
      expect(messages[0]).not.toContain('submitted_answer')
      expect(messages[0]).not.toContain('flag{must-not-leak}')
      expect(JSON.parse(messages[0]!)).toEqual({
        schema: 'public-realtime-event.v1',
        id: event.id,
        contestId: event.aggregateId,
        type: 'scoreboard.refresh',
        version: 11,
        occurredAt: event.occurredAt,
      })
      await expect(internalMessage).resolves.toContain('flag{must-not-leak}')
    }
    finally {
      if (subscriber.isOpen) subscriber.destroy()
      if (inspector.isOpen) inspector.destroy()
      await publisher.close()
    }
  })

  it('bounds each contest recovery log and applies an expiry', async () => {
    const publisher = new RedisDomainEventPublisher(redisUrl)
    const inspector = createClient({ url: redisUrl })
    const contestId = randomUUID()
    const key = contestRealtimeLogKey(contestId)
    try {
      await inspector.connect()
      await inspector.del(key)
      for (let version = 1; version <= 1_001; version += 1) {
        const event = scoreboardEvent(version)
        event.aggregateId = contestId
        event.payload = { contest_id: contestId, version }
        await publisher.publish(event)
      }
      expect(await inspector.lLen(key)).toBe(1_000)
      const firstRetained = JSON.parse((await inspector.lIndex(key, 0))!)
      expect(firstRetained.version).toBe(2)
      const ttl = await inspector.ttl(key)
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(24 * 60 * 60)
    }
    finally {
      if (inspector.isOpen) inspector.destroy()
      await publisher.close()
    }
  })
})
