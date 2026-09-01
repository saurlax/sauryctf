import { describe, expect, it } from 'vitest'
import { monitoringListRequestSchema, monitoringListResponseSchema } from './monitoring'

describe('administration monitoring contracts', () => {
  it('accepts bounded filters and rejects unknown monitoring kinds', () => {
    expect(monitoringListRequestSchema.parse({ kind: 'instance_jobs', status: 'dead', limit: '25' })).toEqual({
      kind: 'instance_jobs', status: 'dead', limit: 25,
    })
    expect(() => monitoringListRequestSchema.parse({ kind: 'checker_runs' })).toThrow()
  })

  it('keeps database, cache and worker observation times distinct', () => {
    expect(monitoringListResponseSchema.parse({
      generated_at: '2026-09-02T00:00:00.000Z',
      source: 'postgresql',
      cache_observed_at: null,
      worker_stale_after_seconds: 90,
      items: [{
        kind: 'instances',
        id: '018f47a2-4ef8-7e2c-9c24-000000000101',
        contest_id: '018f47a2-4ef8-7e2c-9c24-000000000102',
        challenge_id: '018f47a2-4ef8-7e2c-9c24-000000000103',
        team_id: '018f47a2-4ef8-7e2c-9c24-000000000104',
        status: 'running',
        fact_at: '2026-09-01T23:58:00.000Z',
        worker_observed_at: '2026-09-01T23:58:00.000Z',
        worker_observation_stale: true,
        details: { provider: 'docker' },
      }],
    }).items[0]?.worker_observation_stale).toBe(true)
  })
})
