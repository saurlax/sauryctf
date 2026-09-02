import { describe, expect, it, vi } from 'vitest'
import { PostgresControlPlaneReadiness } from './readiness'

describe('PostgreSQL control-plane readiness', () => {
  it('accepts an available database at the exact bundled migration version', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ migration_table: 'control_plane.__drizzle_migrations' }] })
      .mockResolvedValueOnce({ rows: [{ migration_count: '22', latest_migration_at: '1788299100000' }] })

    await expect(new PostgresControlPlaneReadiness({ query } as never).ready()).resolves.toBeUndefined()
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('rejects an empty database without a migration journal', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ migration_table: null }] })
    await expect(new PostgresControlPlaneReadiness({ query } as never).ready())
      .rejects.toThrow('migration journal is unavailable')
  })

  it('rejects a database that is behind or ahead of the bundled release', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ migration_table: 'control_plane.__drizzle_migrations' }] })
      .mockResolvedValueOnce({ rows: [{ migration_count: '21', latest_migration_at: '1788296400000' }] })
    await expect(new PostgresControlPlaneReadiness({ query } as never).ready())
      .rejects.toThrow('migration version does not match')
  })

  it('does not leak the database connection error in its stable message', async () => {
    const query = vi.fn().mockRejectedValue(new Error('postgresql://user:secret@database'))
    await expect(new PostgresControlPlaneReadiness({ query } as never).ready())
      .rejects.toThrow('Authoritative PostgreSQL database is unavailable')
  })
})
