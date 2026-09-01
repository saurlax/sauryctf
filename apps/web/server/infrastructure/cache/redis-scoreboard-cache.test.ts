import { randomUUID } from 'node:crypto'
import { createClient } from 'redis'
import { describe, expect, it } from 'vitest'
import {
  cacheDescriptor,
  scoreboardCacheKey,
} from '../../domains/scoreboards/cache'
import type { ScoreboardProjection } from '../../domains/scoreboards/view-service'
import { ResilientRedisScoreboardCache } from './redis-scoreboard-cache'

function projection(contestId: string): ScoreboardProjection {
  return {
    schema: 'scoreboard-projection.v1',
    contestId,
    view: 'public',
    state: 'live',
    freshness: 'current',
    version: 3,
    frozenAt: null,
    builtAt: '2026-09-01T08:05:00.000Z',
    board: {
      schema: 'scoreboard.v1',
      scope: { type: 'overall' },
      scopeKey: 'overall',
      challenges: [],
      rows: [],
    },
  }
}

describe('disabled Redis scoreboard cache', () => {
  it('acts as a no-op cache when REDIS_URL is absent', async () => {
    const cache = new ResilientRedisScoreboardCache()
    const value = projection(randomUUID())
    await expect(cache.set(value)).resolves.toBeUndefined()
    await expect(cache.get(cacheDescriptor(value))).resolves.toBeNull()
    await expect(cache.close()).resolves.toBeUndefined()
  })
})

const redisUrl = process.env.TEST_REDIS_URL
const describeWithRedis = redisUrl ? describe : describe.skip

describeWithRedis('Redis scoreboard cache adapter', () => {
  it('round-trips a public projection with a short live TTL', async () => {
    const cache = new ResilientRedisScoreboardCache(redisUrl)
    const inspector = createClient({ url: redisUrl })
    const value = projection(randomUUID())
    try {
      await inspector.connect()
      await cache.set(value)
      await expect(cache.get(cacheDescriptor(value))).resolves.toEqual(value)
      const ttl = await inspector.ttl(scoreboardCacheKey(cacheDescriptor(value)))
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(60)
    }
    finally {
      if (inspector.isOpen) inspector.destroy()
      await cache.close()
    }
  })

  it('deletes malformed values instead of returning them', async () => {
    const cache = new ResilientRedisScoreboardCache(redisUrl)
    const inspector = createClient({ url: redisUrl })
    const value = projection(randomUUID())
    const key = scoreboardCacheKey(cacheDescriptor(value))
    try {
      await inspector.connect()
      await inspector.set(key, '{invalid')
      await expect(cache.get(cacheDescriptor(value))).resolves.toBeNull()
      await expect(inspector.get(key)).resolves.toBeNull()
    }
    finally {
      if (inspector.isOpen) inspector.destroy()
      await cache.close()
    }
  })
})
