import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  DomainOutboxDispatcher,
  serializeDomainEvent,
  type ClaimedDomainEvent,
  type DomainEventPublisher,
  type DomainOutboxRepository,
} from './domain-outbox'

function event(): ClaimedDomainEvent {
  const contestId = randomUUID()
  return {
    schema: 'domain-event.v1',
    id: randomUUID(),
    aggregateType: 'contest',
    aggregateId: contestId,
    eventType: 'scoreboard.version_changed',
    eventVersion: 1,
    payload: { contest_id: contestId, version: 4 },
    occurredAt: '2026-09-01T08:00:00.000Z',
    attemptCount: 1,
  }
}

describe('domain outbox dispatcher', () => {
  it('treats a publisher duplicate as success after a crash-window retry', async () => {
    const claimed = event()
    let claimCount = 0
    let markCount = 0
    const repository: DomainOutboxRepository = {
      claim: vi.fn(async () => {
        claimCount += 1
        return claimCount <= 2 ? [{ ...claimed, attemptCount: claimCount }] : []
      }),
      markPublished: vi.fn(async () => {
        markCount += 1
        return markCount > 1
      }),
      markFailed: vi.fn(async () => true),
    }
    const applied = new Set<string>()
    const publisher: DomainEventPublisher = {
      publish: vi.fn(async (value) => {
        if (applied.has(value.id)) return 'duplicate'
        applied.add(value.id)
        return 'published'
      }),
    }
    const dispatcher = new DomainOutboxDispatcher(repository, publisher)

    expect(await dispatcher.runOnce()).toBe(1)
    expect(await dispatcher.runOnce()).toBe(1)
    expect(applied.size).toBe(1)
    expect(repository.markPublished).toHaveBeenCalledTimes(2)
    expect(repository.markFailed).not.toHaveBeenCalled()
  })

  it('records a bounded retry without leaking the publisher error message', async () => {
    const claimed = event()
    const repository: DomainOutboxRepository = {
      claim: vi.fn(async () => [claimed]),
      markPublished: vi.fn(async () => true),
      markFailed: vi.fn(async () => true),
    }
    class SensitivePublisherError extends Error {
      override name = 'SensitivePublisherError'
    }
    const publisher: DomainEventPublisher = {
      publish: vi.fn(async () => {
        throw new SensitivePublisherError('redis://secret@example.test')
      }),
    }
    const dispatcher = new DomainOutboxDispatcher(
      repository,
      publisher,
      () => new Date('2026-09-01T08:00:00.000Z'),
    )

    await dispatcher.runOnce()
    expect(repository.markPublished).not.toHaveBeenCalled()
    expect(repository.markFailed).toHaveBeenCalledWith(
      claimed.id,
      1,
      new Date('2026-09-01T08:00:01.000Z'),
      'SensitivePublisherError',
    )
  })

  it('validates batch limits and event serialization', async () => {
    const dispatcher = new DomainOutboxDispatcher(
      { claim: vi.fn(), markPublished: vi.fn(), markFailed: vi.fn() },
      { publish: vi.fn() },
    )
    await expect(dispatcher.runOnce(0)).rejects.toBeInstanceOf(RangeError)
    const { attemptCount: _attemptCount, ...domainEvent } = event()
    expect(JSON.parse(serializeDomainEvent(domainEvent))).toMatchObject({
      schema: 'domain-event.v1',
      eventType: 'scoreboard.version_changed',
    })
  })
})
