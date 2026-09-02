import { describe, expect, it, vi } from 'vitest'
import { expectedMigrationBaseline } from '../../db/migration-baseline'
import { PostgresControlPlaneReadiness } from './readiness'

const baseline = expectedMigrationBaseline()

describe('PostgreSQL control-plane readiness', () => {
  it('accepts an exact NuxtHub journal without a legacy journal', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ hub_journal: '_hub_migrations', legacy_journal: null }] })
      .mockResolvedValueOnce({ rows: baseline.map(({ name }) => ({ name })) })

    await expect(new PostgresControlPlaneReadiness({ query } as never).ready()).resolves.toBeUndefined()
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('accepts a safely claimed legacy journal during the transition window', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ hub_journal: '_hub_migrations', legacy_journal: 'control_plane.__drizzle_migrations' }],
      })
      .mockResolvedValueOnce({ rows: baseline.map(({ name }) => ({ name })) })
      .mockResolvedValueOnce({
        rows: baseline.map(({ sha256, legacyCreatedAt }) => ({
          hash: sha256,
          created_at: String(legacyCreatedAt),
        })),
      })

    await expect(new PostgresControlPlaneReadiness({ query } as never).ready()).resolves.toBeUndefined()
  })

  it('rejects an empty database without the NuxtHub journal', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ hub_journal: null, legacy_journal: null }] })
    await expect(new PostgresControlPlaneReadiness({ query } as never).ready())
      .rejects.toThrow('NuxtHub migration journal is unavailable')
  })

  it('rejects a database that is behind, ahead, reordered, or unknown', async () => {
    for (const names of [
      baseline.slice(0, -1).map(({ name }) => name),
      [...baseline.map(({ name }) => name), '9999_unknown'],
      [baseline[1]!.name, baseline[0]!.name, ...baseline.slice(2).map(({ name }) => name)],
    ]) {
      const query = vi.fn()
        .mockResolvedValueOnce({ rows: [{ hub_journal: '_hub_migrations', legacy_journal: null }] })
        .mockResolvedValueOnce({ rows: names.map(name => ({ name })) })
      await expect(new PostgresControlPlaneReadiness({ query } as never).ready())
        .rejects.toThrow('migration version does not match')
    }
  })

  it('rejects a mismatched legacy journal even when NuxtHub names match', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ hub_journal: '_hub_migrations', legacy_journal: 'control_plane.__drizzle_migrations' }],
      })
      .mockResolvedValueOnce({ rows: baseline.map(({ name }) => ({ name })) })
      .mockResolvedValueOnce({ rows: [] })
    await expect(new PostgresControlPlaneReadiness({ query } as never).ready())
      .rejects.toThrow('has not been safely claimed')
  })

  it('does not leak the database connection error in its stable message', async () => {
    const query = vi.fn().mockRejectedValue(new Error('postgresql://user:secret@database'))
    await expect(new PostgresControlPlaneReadiness({ query } as never).ready())
      .rejects.toThrow('Authoritative PostgreSQL database is unavailable')
  })
})
