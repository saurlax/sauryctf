import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { rateLimitWindows } from './schema'

describe('PostgreSQL rate limit window schema', () => {
  it('stores only a SHA-256 bucket digest and window counters', () => {
    expect(getTableName(rateLimitWindows)).toBe('rate_limit_windows')
    expect(Object.keys(getTableColumns(rateLimitWindows))).toEqual([
      'bucketDigest',
      'windowStartedAt',
      'expiresAt',
      'requestCount',
    ])
  })

  it('does not define columns for raw identities, request input, credentials, or Flags', async () => {
    const migration = await readFile(fileURLToPath(new URL(
      './migrations/postgresql/0022_rate_limit_windows.sql',
      import.meta.url,
    )), 'utf8')
    const columnDefinitions = migration
      .split('\n')
      .filter(line => /^\s*"[a-z_]+"/u.test(line))
      .join('\n')

    expect(columnDefinitions).not.toMatch(/\b(ip|identity|input|credential|password|token|flag)\b/iu)
    expect(migration).toContain('rate_limit_windows_bucket_digest_sha256')
    expect(migration).toContain('rate_limit_windows_bucket_window_unique')
    expect(migration).toContain('rate_limit_windows_expiry')
  })
})
