import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ResilientRedisScoreboardBuildLock } from './redis-scoreboard-build-lock'

describe('disabled Redis scoreboard build lock', () => {
  it('reports unavailable without treating the lock as authoritative', async () => {
    const lock = new ResilientRedisScoreboardBuildLock()
    await expect(lock.acquire('build', randomUUID(), 1_000)).resolves.toBe('unavailable')
    await lock.close()
  })
})

const redisUrl = process.env.TEST_REDIS_URL
const describeWithRedis = redisUrl ? describe : describe.skip

describeWithRedis('Redis scoreboard build lock', () => {
  it('allows one owner, fences release, and permits acquisition after release', async () => {
    const first = new ResilientRedisScoreboardBuildLock(redisUrl)
    const second = new ResilientRedisScoreboardBuildLock(redisUrl)
    const key = `build:${randomUUID()}`
    const firstOwner = randomUUID()
    const secondOwner = randomUUID()
    try {
      await expect(first.acquire(key, firstOwner, 5_000)).resolves.toBe('acquired')
      await expect(second.acquire(key, secondOwner, 5_000)).resolves.toBe('contended')
      await second.release(key, secondOwner)
      await expect(second.acquire(key, secondOwner, 5_000)).resolves.toBe('contended')
      await first.release(key, firstOwner)
      await expect(second.acquire(key, secondOwner, 5_000)).resolves.toBe('acquired')
    }
    finally {
      await second.release(key, secondOwner)
      await first.close()
      await second.close()
    }
  })
})
