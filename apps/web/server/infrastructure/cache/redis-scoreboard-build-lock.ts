import { createClient } from 'redis'
import type {
  ScoreboardBuildLock,
  ScoreboardBuildLockResult,
} from '../../domains/scoreboards/build-coordinator'

const releaseScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

export class ResilientRedisScoreboardBuildLock implements ScoreboardBuildLock {
  private readonly client
  private connecting: Promise<unknown> | null = null

  constructor(redisUrl?: string) {
    this.client = redisUrl ? createClient({ url: redisUrl }) : null
    this.client?.on('error', () => {})
  }

  async acquire(key: string, owner: string, ttlMs: number): Promise<ScoreboardBuildLockResult> {
    if (!this.client) return 'unavailable'
    try {
      await this.ensureConnected()
      const result = await this.client.set(scoreboardBuildLockKey(key), owner, {
        NX: true,
        PX: ttlMs,
      })
      return result === 'OK' ? 'acquired' : 'contended'
    }
    catch {
      return 'unavailable'
    }
  }

  async release(key: string, owner: string): Promise<void> {
    if (!this.client) return
    try {
      await this.ensureConnected()
      await this.client.eval(releaseScript, {
        keys: [scoreboardBuildLockKey(key)],
        arguments: [owner],
      })
    }
    catch {
      // The short lease expires without becoming an authority boundary.
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

export function scoreboardBuildLockKey(key: string): string {
  return `sauryctf:scoreboard-build-lock:v1:${encodeURIComponent(key)}`
}
