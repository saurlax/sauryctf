import { describe, expect, it } from 'vitest'
import { submitFlagRequestSchema, submitFlagResponseSchema } from './submissions'

describe('submission contracts', () => {
  it('accepts one bounded Flag and rejects undeclared request fields', () => {
    expect(submitFlagRequestSchema.parse({ flag: 'flag{answer}' })).toEqual({ flag: 'flag{answer}' })
    expect(() => submitFlagRequestSchema.parse({ flag: 'flag{answer}', mode: 'practice' })).toThrow()
    expect(() => submitFlagRequestSchema.parse({ flag: 'x'.repeat(1025) })).toThrow()
  })

  it('exposes only the redacted synchronous verdict', () => {
    expect(submitFlagResponseSchema.parse({ result: 'correct' })).toEqual({ result: 'correct' })
    expect(() => submitFlagResponseSchema.parse({ result: 'correct', submitted_flag: 'flag{answer}' })).toThrow()
  })
})
