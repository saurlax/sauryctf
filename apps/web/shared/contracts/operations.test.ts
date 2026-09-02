import { describe, expect, it } from 'vitest'
import {
  executeOperationalCommandRequestSchema,
  operationalCommandSchema,
  operationalCommandKindSchema,
} from './operations'

describe('administration operational command contracts', () => {
  it('covers only the five first-release repair commands', () => {
    expect(operationalCommandKindSchema.options).toEqual([
      'cache_rebuild',
      'dead_letter_replay',
      'instance_reconcile',
      'session_invalidate',
      'result_recalculate',
    ])
  })

  it('requires an explicit confirmation and a meaningful reason', () => {
    const input = {
      kind: 'instance_reconcile',
      target_id: '018f47a2-4ef8-7e2c-9c24-000000000501',
      reason: 'Worker observation is stale and needs reconciliation',
      confirmed: true,
    }
    expect(executeOperationalCommandRequestSchema.parse(input)).toEqual(input)
    expect(() => executeOperationalCommandRequestSchema.parse({ ...input, confirmed: false })).toThrow()
    expect(() => executeOperationalCommandRequestSchema.parse({ ...input, reason: 'retry' })).toThrow()
  })

  it('returns only a completed, bounded scalar result', () => {
    expect(operationalCommandSchema.parse({
      id: '018f47a2-4ef8-7e2c-9c24-000000000502',
      kind: 'dead_letter_replay',
      target_id: '018f47a2-4ef8-7e2c-9c24-000000000503',
      status: 'succeeded',
      replayed: false,
      completed_at: '2026-09-02T00:00:00.000Z',
      result: { next_attempt: 9 },
    }).result).toEqual({ next_attempt: 9 })
  })
})
