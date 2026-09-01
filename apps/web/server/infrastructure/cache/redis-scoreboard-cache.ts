import { createClient } from 'redis'
import {
  cacheDescriptor,
  parseScoreboardCacheValue,
  scoreboardCacheKey,
  serializeScoreboardCacheValue,
  type ScoreboardCacheDescriptor,
  type ScoreboardProjectionCache,
} from '../../domains/scoreboards/cache'
import type { ScoreboardProjection } from '../../domains/scoreboards/view-service'

const liveTtlSeconds = 60
const durableTtlSeconds = 24 * 60 * 60

export class ResilientRedisScoreboardCache implements ScoreboardProjectionCache {
  private readonly client
  private connecting: Promise<unknown> | null = null

  constructor(redisUrl?: string) {
    this.client = redisUrl ? createClient({ url: redisUrl }) : null
    this.client?.on('error', () => {})
  }

  async get(descriptor: ScoreboardCacheDescriptor): Promise<ScoreboardProjection | null> {
    if (!this.client || descriptor.view !== 'public') return null
    const key = scoreboardCacheKey(descriptor)
    try {
      await this.ensureConnected()
      const serialized = await this.client.get(key)
      if (serialized === null) return null
      const value = parseScoreboardCacheValue(descriptor, serialized)
      if (!value) await this.client.del(key)
      return value
    }
    catch {
      return null
    }
  }

  async set(projection: ScoreboardProjection): Promise<void> {
    if (!this.client || projection.view !== 'public') return
    try {
      await this.ensureConnected()
      await this.client.set(
        scoreboardCacheKey(cacheDescriptor(projection)),
        serializeScoreboardCacheValue(projection),
        { EX: projection.state === 'live' ? liveTtlSeconds : durableTtlSeconds },
      )
    }
    catch {
      // Redis is an optional projection cache; authoritative reads remain available.
    }
  }

  async close(): Promise<void> {
    if (this.client?.isOpen) this.client.destroy()
  }

  private async ensureConnected(): Promise<void> {
    if (!this.client || this.client.isReady) return
    this.connecting ??= this.client.connect().finally(() => { this.connecting = null })
    await this.connecting
  }
}
