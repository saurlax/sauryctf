import { describe, expect, it, vi } from 'vitest'
import type { DataRetentionRepository } from './data-retention'
import {
  auditRetentionMs,
  DataRetentionService,
  officialContestFactsRetention,
  securityLogRetentionMs,
} from './data-retention'

const now = new Date('2026-09-02T00:00:00.000Z')

describe('data retention service', () => {
  it('uses fixed one-year and 90-day boundaries while declaring official facts indefinite', async () => {
    const repository: DataRetentionRepository = {
      purgeExpired: vi.fn(async () => ({ auditDeleted: 0, securityLogsDeleted: 0, rateLimitWindowsDeleted: 0 })),
    }
    const service = new DataRetentionService(repository, () => now)

    await expect(service.run()).resolves.toEqual({
      auditDeleted: 0,
      securityLogsDeleted: 0,
      rateLimitWindowsDeleted: 0,
      batches: 1,
      auditBefore: new Date(now.getTime() - auditRetentionMs),
      securityBefore: new Date(now.getTime() - securityLogRetentionMs),
      officialContestFacts: officialContestFactsRetention,
    })
    expect(repository.purgeExpired).toHaveBeenCalledWith({
      auditBefore: new Date(now.getTime() - auditRetentionMs),
      securityBefore: new Date(now.getTime() - securityLogRetentionMs),
      limit: 1_000,
    })
  })

  it('drains bounded batches without allowing an unbounded startup cleanup', async () => {
    const repository: DataRetentionRepository = {
      purgeExpired: vi.fn()
        .mockResolvedValueOnce({ auditDeleted: 2, securityLogsDeleted: 0, rateLimitWindowsDeleted: 2 })
        .mockResolvedValueOnce({ auditDeleted: 1, securityLogsDeleted: 1, rateLimitWindowsDeleted: 0 }),
    }
    const service = new DataRetentionService(repository, () => now)

    await expect(service.run(2, 5)).resolves.toMatchObject({
      auditDeleted: 3,
      securityLogsDeleted: 1,
      rateLimitWindowsDeleted: 2,
      batches: 2,
    })
    expect(repository.purgeExpired).toHaveBeenCalledTimes(2)
  })

  it('rejects unsafe batch configuration and invalid clocks', async () => {
    const repository: DataRetentionRepository = {
      purgeExpired: vi.fn(async () => ({ auditDeleted: 0, securityLogsDeleted: 0, rateLimitWindowsDeleted: 0 })),
    }
    await expect(new DataRetentionService(repository, () => now).run(0)).rejects.toThrow(RangeError)
    await expect(new DataRetentionService(repository, () => new Date(Number.NaN)).run()).rejects.toThrow(RangeError)
    expect(repository.purgeExpired).not.toHaveBeenCalled()
  })
})
