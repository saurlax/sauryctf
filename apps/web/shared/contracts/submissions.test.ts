import { describe, expect, it } from 'vitest'
import {
  cheatClueListResponseSchema,
  managedSubmissionListResponseSchema,
  reviewCheatClueRequestSchema,
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
    expect(submitFlagResponseSchema.parse({ result: 'correct', mode: 'official' }))
      .toEqual({ result: 'correct', mode: 'official' })
    expect(submitFlagResponseSchema.parse({ result: 'already_solved', mode: 'practice' }))
      .toEqual({ result: 'already_solved', mode: 'practice' })
    expect(() => submitFlagResponseSchema.parse({
      result: 'correct',
      mode: 'official',
      submitted_flag: 'flag{answer}',
    })).toThrow()
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

  it('accepts only typed answer-fingerprint evidence and declared review transitions', () => {
    const response = cheatClueListResponseSchema.parse({
      items: [{
        id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f90',
        contest_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f91',
        challenge_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f92',
        participation_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f93',
        clue_type: 'repeated_incorrect_answer',
        evidence: {
          schema: 'cheat-clue.v1',
          kind: 'repeated_incorrect_answer',
          answer_fingerprint: 'a'.repeat(64),
          trigger_submission_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f94',
          participation_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f93',
          challenge_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f92',
          mode: 'official',
          matching_submission_count: 3,
          first_seen_at: '2026-09-01T08:00:00.000Z',
          last_seen_at: '2026-09-01T08:01:00.000Z',
        },
        status: 'open',
        reviewed_by: null,
        review_note: null,
        reviewed_at: null,
        created_at: '2026-09-01T08:01:00.000Z',
        updated_at: '2026-09-01T08:01:00.000Z',
      }],
      page: { next_cursor: null, has_more: false },
    })
    expect(JSON.stringify(response)).not.toMatch(/flag\{|ciphertext|plaintext/u)
    expect(() => cheatClueListResponseSchema.parse({
      ...response,
      items: [{
        ...response.items[0],
        evidence: { ...response.items[0]!.evidence, submitted_flag: 'flag{secret}' },
      }],
    })).toThrow()
    expect(reviewCheatClueRequestSchema.parse({ status: 'reviewing' }))
      .toEqual({ status: 'reviewing' })
    expect(() => reviewCheatClueRequestSchema.parse({ status: 'open' })).toThrow()
  })
})
