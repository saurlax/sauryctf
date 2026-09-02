import { createHash } from 'node:crypto'

export interface RateLimitDecision {
  allowed: boolean
  limit: number
  remaining: number
  retryAfterMs: number
}

export interface RateLimitPolicy {
  bucket: string
  limit: number
  windowMs: number
}

export interface RateLimitStore {
  consume(bucket: string, limit: number, windowMs: number): Promise<RateLimitDecision>
  consumeMany(policies: readonly RateLimitPolicy[]): Promise<RateLimitDecision[]>
}

interface MemoryWindow {
  count: number
  expiresAt: number
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, MemoryWindow>()

  constructor(private readonly now: () => number = Date.now) {}

  async consume(bucket: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    return (await this.consumeMany([{ bucket, limit, windowMs }]))[0]!
  }

  async consumeMany(policies: readonly RateLimitPolicy[]): Promise<RateLimitDecision[]> {
    const now = this.now()
    return policies.map(({ bucket, limit, windowMs }) => {
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
    })
  }
}

export function rateLimitBucket(scope: string, identity: string, action: string): string {
  const identityDigest = createHash('sha256').update(identity, 'utf8').digest('hex')
  return `${scope}:${action}:${identityDigest}`
}
