import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AesGcmSubmissionAnswerProtector,
  SubmissionAnswerProtectionError,
} from './submission-answer-protector'

const context = {
  contestId: '018f47a2-4ef8-7e2c-9c24-6d68b7451fa0',
  challengeId: '018f47a2-4ef8-7e2c-9c24-6d68b7451fa1',
  participationId: '018f47a2-4ef8-7e2c-9c24-6d68b7451fa2',
  teamId: '018f47a2-4ef8-7e2c-9c24-6d68b7451fa3',
  userId: '018f47a2-4ef8-7e2c-9c24-6d68b7451fa4',
  requestId: '018f47a2-4ef8-7e2c-9c24-6d68b7451fa5',
}

describe('submission answer protection', () => {
  it('creates deterministic HMAC digests and randomized authenticated ciphertext', () => {
    const protector = new AesGcmSubmissionAnswerProtector(randomBytes(32))
    const first = protector.protect('flag{secret-answer}', context)
    const second = protector.protect('flag{secret-answer}', context)
    expect(first.digest).toEqual(second.digest)
    expect(first.digest).toHaveLength(32)
    expect(first.ciphertext).not.toEqual(second.ciphertext)
    expect(first.ciphertext.includes(Buffer.from('flag{secret-answer}'))).toBe(false)
    expect(protector.reveal(first.ciphertext, context)).toBe('flag{secret-answer}')
  })

  it('binds ciphertext to submission context and rejects malformed keys or envelopes', () => {
    expect(() => new AesGcmSubmissionAnswerProtector(randomBytes(31))).toThrowError(
      SubmissionAnswerProtectionError,
    )
    const protector = new AesGcmSubmissionAnswerProtector(randomBytes(32))
    const protectedAnswer = protector.protect('flag{secret-answer}', context)
    expect(() => protector.reveal(protectedAnswer.ciphertext, {
      ...context,
      challengeId: '018f47a2-4ef8-7e2c-9c24-6d68b7451faf',
    })).toThrowError(SubmissionAnswerProtectionError)
    expect(() => protector.reveal(Buffer.from('invalid'), context)).toThrowError(
      SubmissionAnswerProtectionError,
    )
  })
})
