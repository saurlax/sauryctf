import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  apiErrorSchema,
  cursorPageSchema,
  entityTagForVersion,
  paginationRequestSchema,
  versionFromIfMatch,
  versionedResourceSchema,
} from './http'

const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c'

describe('stable API error contract', () => {
  it('accepts code, message, request id and field errors', () => {
    const result = apiErrorSchema.parse({
      error: {
        code: 'validation.failed',
        message: '请求字段无效',
        request_id: requestId,
        fields: {
          email: ['邮箱格式无效'],
        },
      },
    })

    expect(result.error.code).toBe('validation.failed')
    expect(result.error.fields.email).toEqual(['邮箱格式无效'])
  })

  it('rejects the legacy flat string error', () => {
    expect(() => apiErrorSchema.parse({ error: 'invalid request' })).toThrow()
  })

  it('requires a namespaced code, message and request id', () => {
    expect(() => apiErrorSchema.parse({
      error: {
        code: 'invalid',
        message: '',
        request_id: 'request-1',
        fields: {},
      },
    })).toThrow()
  })
})

describe('cursor pagination contract', () => {
  const pageSchema = cursorPageSchema(z.strictObject({ id: z.uuid() }))

  it('applies the default limit and accepts an opaque cursor', () => {
    expect(paginationRequestSchema.parse({ cursor: 'eyJpZCI6IjEyMyJ9' })).toEqual({
      cursor: 'eyJpZCI6IjEyMyJ9',
      limit: 20,
    })
  })

  it('rejects offset-style or excessive requests', () => {
    expect(() => paginationRequestSchema.parse({ offset: 20 })).toThrow()
    expect(() => paginationRequestSchema.parse({ limit: 101 })).toThrow()
  })

  it('requires explicit page metadata', () => {
    expect(() => pageSchema.parse({ items: [] })).toThrow()
    expect(pageSchema.parse({
      items: [{ id: requestId }],
      page: { next_cursor: null, has_more: false },
    }).page.has_more).toBe(false)
  })
})

describe('resource version contract', () => {
  const resourceSchema = versionedResourceSchema({ id: z.uuid(), name: z.string() })

  it('requires a positive resource version', () => {
    expect(resourceSchema.parse({ id: requestId, name: 'example', version: 3 }).version).toBe(3)
    expect(() => resourceSchema.parse({ id: requestId, name: 'example', version: 0 })).toThrow()
  })

  it('round-trips the strong If-Match entity tag', () => {
    expect(entityTagForVersion(7)).toBe('"7"')
    expect(versionFromIfMatch('"7"')).toBe(7)
    expect(versionFromIfMatch('W/"7"')).toBeNull()
    expect(versionFromIfMatch('*')).toBeNull()
  })
})
