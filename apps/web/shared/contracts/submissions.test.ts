import { describe, expect, it } from 'vitest'
import {
  managedSubmissionListResponseSchema,
  submitFlagRequestSchema,
  submitFlagResponseSchema,
} from './submissions'

describe('submission contracts', () => {
  it('accepts one bounded Flag and rejects undeclared request fields', () => {
    expect(submitFlagRequestSchema.parse({ flag: 'flag{answer}' })).toEqual({ flag: 'flag{answer}' })
    expect(() => submitFlagRequestSchema.parse({ flag: 'flag{answer}', mode: 'practice' })).toThrow()
    expect(() => submitFlagRequestSchema.parse({ flag: 'x'.repeat(1025) })).toThrow()
  })

  it('exposes only the redacted synchronous verdict', () => {
    expect(submitFlagResponseSchema.parse({ result: 'correct' })).toEqual({ result: 'correct' })
    expect(submitFlagResponseSchema.parse({ result: 'already_solved' })).toEqual({ result: 'already_solved' })
    expect(() => submitFlagResponseSchema.parse({ result: 'correct', submitted_flag: 'flag{answer}' })).toThrow()
  })

  it('allows ordinary management projections to expose only a fixed answer mask', () => {
    const response = managedSubmissionListResponseSchema.parse({
      items: [{
        id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f90',
        contest_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f91',
        challenge_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f92',
        participation_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f93',
        user_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f94',
        mode: 'official',
        result: 'incorrect',
        answer_masked: '••••••••',
        submitted_at: '2026-09-01T08:00:00.000Z',
      }],
      page: { next_cursor: null, has_more: false },
    })
    expect(JSON.stringify(response)).not.toMatch(/digest|ciphertext|flag\{/u)
    expect(() => managedSubmissionListResponseSchema.parse({
      ...response,
      items: [{ ...response.items[0], answer_masked: 'flag{secret}' }],
    })).toThrow()
  })
})
