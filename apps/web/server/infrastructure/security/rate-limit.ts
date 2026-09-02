import { createHash } from 'node:crypto'
import { createResilientRedisClient } from '../cache/resilient-redis-client'

export interface RateLimitDecision {
  allowed: boolean
  limit: number
  remaining: number
  retryAfterMs: number
}

export interface RateLimitStore {
  consume(bucket: string, limit: number, windowMs: number): Promise<RateLimitDecision>
}

interface MemoryWindow {
  count: number
  expiresAt: number
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, MemoryWindow>()

  constructor(private readonly now: () => number = Date.now) {}

  async consume(bucket: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    const now = this.now()
    const current = this.windows.get(bucket)
    const window = !current || current.expiresAt <= now
      ? { count: 0, expiresAt: now + windowMs }
      : current
    window.count += 1
    this.windows.set(bucket, window)
    return {
      allowed: window.count <= limit,
      limit,
      remaining: Math.max(0, limit - window.count),
      retryAfterMs: Math.max(1, window.expiresAt - now),
    }
  }
}

const consumeScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { count, ttl }
`

export class ResilientRedisRateLimitStore implements RateLimitStore {
  private readonly fallback = new MemoryRateLimitStore()
  private readonly client
  private connecting: Promise<unknown> | null = null

  constructor(redisUrl?: string) {
    this.client = createResilientRedisClient(redisUrl)
    this.client?.on('error', () => {})
  }

  async consume(bucket: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    if (!this.client) return this.fallback.consume(bucket, limit, windowMs)
    try {
      if (!this.client.isReady) {
        this.connecting ??= this.client.connect().finally(() => { this.connecting = null })
        await this.connecting
      }
      const result = await this.client.eval(consumeScript, {
        keys: [`sauryctf:rate:v1:${bucket}`],
        arguments: [String(windowMs)],
      }) as [number, number]
      const count = Number(result[0])
      const ttl = Math.max(1, Number(result[1]))
      return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        retryAfterMs: ttl,
      }
    }
    catch {
      return this.fallback.consume(bucket, limit, windowMs)
    }
  }

  async close(): Promise<void> {
    if (this.client?.isOpen) this.client.destroy()
  }
}

export function rateLimitBucket(scope: string, identity: string, action: string): string {
  const identityDigest = createHash('sha256').update(identity, 'utf8').digest('hex')
  return `${scope}:${action}:${identityDigest}`
}
