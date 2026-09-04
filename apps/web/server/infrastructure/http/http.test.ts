import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { apiErrorSchema } from '../../../shared/contracts/http'
import { parseJsonText } from './body'
import { createApiError, normalizeApiError } from './errors'

const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c'

describe('JSON request parsing', () => {
  it('rejects malformed JSON with a stable error', () => {
    try {
      parseJsonText('{"flag":')
      expect.unreachable()
    } catch (error) {
      const response = normalizeApiError(error, requestId)
      expect(response.statusCode).toBe(400)
      expect(apiErrorSchema.parse(response.body).error.code).toBe('request.malformed_json')
    }
  })

  it('rejects an oversized UTF-8 body', () => {
    try {
      parseJsonText('"密"', 2)
      expect.unreachable()
    } catch (error) {
      expect(normalizeApiError(error, requestId).body.error.code).toBe('request.body_too_large')
    }
  })
})

describe('unified API errors', () => {
  it('preserves explicit domain errors', () => {
    const response = normalizeApiError(
      createApiError(409, 'resource.version_conflict', '资源版本冲突'),
      requestId,
    )
    expect(response.statusCode).toBe(409)
    expect(response.body.error.code).toBe('resource.version_conflict')
  })

  it('maps Zod field issues', () => {
    const schema = z.object({ email: z.email() })
    const result = schema.safeParse({ email: 'invalid' })
    if (result.success) expect.unreachable()

    const response = normalizeApiError(result.error, requestId)
    expect(response.body.error.fields).toHaveProperty('email')
  })

  it('maps a Zod error wrapped by the runtime', () => {
    const schema = z.object({ token: z.string().min(1) })
    const result = schema.safeParse({ token: '' })
    if (result.success) expect.unreachable()

    const response = normalizeApiError(new Error('runtime wrapper', { cause: result.error }), requestId)
    expect(response.statusCode).toBe(400)
    expect(response.body.error).toMatchObject({
      code: 'validation.failed',
      fields: { token: expect.any(Array) },
    })
  })

  it('does not expose unknown exception messages', () => {
    const response = normalizeApiError(new Error('password=secret-value'), requestId)
    expect(JSON.stringify(response.body)).not.toContain('secret-value')
    expect(response.body.error.code).toBe('internal.unexpected')
  })
})
