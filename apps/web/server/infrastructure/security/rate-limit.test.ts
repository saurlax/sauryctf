import { describe, expect, it } from 'vitest'
import {
  MemoryRateLimitStore,
  rateLimitBucket,
} from './rate-limit'

describe('rate limit stores', () => {
  it('enforces a fixed window and resets after expiry', async () => {
    let now = 1_000
    const store = new MemoryRateLimitStore(() => now)
    const bucket = rateLimitBucket('network', '192.0.2.10', 'identity.login')
    expect((await store.consume(bucket, 2, 1_000)).allowed).toBe(true)
    expect((await store.consume(bucket, 2, 1_000)).allowed).toBe(true)
    expect((await store.consume(bucket, 2, 1_000)).allowed).toBe(false)
    now = 2_001
    expect((await store.consume(bucket, 2, 1_000)).allowed).toBe(true)
  })

  it('hashes network and user identities before persistence', () => {
    const bucket = rateLimitBucket('user', '018f47a2-4ef8-7e2c-9c24-6d68b7451f2d', 'identity.password.change')
    expect(bucket).toMatch(/^user:identity\.password\.change:[a-f0-9]{64}$/u)
    expect(bucket).not.toContain('018f47a2')
  })
})
