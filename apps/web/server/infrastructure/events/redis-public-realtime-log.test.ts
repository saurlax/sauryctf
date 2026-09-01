import { randomUUID } from 'node:crypto'
import { createClient } from 'redis'
import { describe, expect, it, vi } from 'vitest'
import type { PublicRealtimeEvent } from '../../domains/events/public-realtime'
import { contestRealtimeChannel, contestRealtimeLogKey } from './redis-domain-event-publisher'
import { RedisPublicRealtimeLog } from './redis-public-realtime-log'

function refresh(contestId: string, version: number): PublicRealtimeEvent {
  return {
    schema: 'public-realtime-event.v1',
    id: randomUUID(),
    contestId,
    type: 'scoreboard.refresh',
    version,
    occurredAt: '2026-09-01T08:00:00.000Z',
  }
}

describe('disabled public realtime log', () => {
  it('requests a full refresh when a recovery cursor cannot be checked', async () => {
    const log = new RedisPublicRealtimeLog()
    await expect(log.recover(randomUUID(), randomUUID())).resolves.toEqual({ status: 'reset' })
    await expect(log.recover(randomUUID(), null)).resolves.toEqual({ status: 'reset' })
    await expect(log.subscribe(randomUUID(), vi.fn())).resolves.toEqual(expect.any(Function))
    await log.close()
  })
})

const redisUrl = process.env.TEST_REDIS_URL
const describeWithRedis = redisUrl ? describe : describe.skip

describeWithRedis('Redis public realtime recovery and subscriptions', () => {
  it('replays only events after Last-Event-ID and resets for a missing window', async () => {
    const contestId = randomUUID()
    const events = [refresh(contestId, 1), refresh(contestId, 2), refresh(contestId, 3)]
    const writer = createClient({ url: redisUrl })
    const log = new RedisPublicRealtimeLog(redisUrl)
    try {
      await writer.connect()
      await writer.del(contestRealtimeLogKey(contestId))
      await writer.rPush(contestRealtimeLogKey(contestId), events.map(event => JSON.stringify(event)))

      await expect(log.recover(contestId, events[0]!.id)).resolves.toEqual({
        status: 'recovered',
        events: events.slice(1),
      })
      await expect(log.recover(contestId, randomUUID())).resolves.toEqual({ status: 'reset' })
      await expect(log.recover(contestId, null)).resolves.toEqual({ status: 'recovered', events: [] })
    }
    finally {
      if (writer.isOpen) writer.destroy()
      await log.close()
    }
  })

  it('isolates subscriptions by contest and rejects malformed public messages', async () => {
    const contestId = randomUUID()
    const otherContestId = randomUUID()
    const writer = createClient({ url: redisUrl })
    const log = new RedisPublicRealtimeLog(redisUrl)
    const received: PublicRealtimeEvent[] = []
    try {
      await writer.connect()
      const unsubscribe = await log.subscribe(contestId, (event) => { received.push(event) })
      await writer.publish(contestRealtimeChannel(otherContestId), JSON.stringify(refresh(otherContestId, 1)))
      await writer.publish(contestRealtimeChannel(contestId), '{bad json')
      const expected = refresh(contestId, 2)
      await writer.publish(contestRealtimeChannel(contestId), JSON.stringify(expected))
      await vi.waitFor(() => expect(received).toEqual([expected]))
      await unsubscribe()
    }
    finally {
      if (writer.isOpen) writer.destroy()
      await log.close()
    }
  })
})
