import { z } from 'zod'
import { resourceVersionSchema, uuidSchema } from './common-types'

export const requestIdSchema = uuidSchema

export const errorCodeSchema = z.string()
  .min(3)
  .max(96)
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u)

export const fieldErrorsSchema = z.record(
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
)

export const apiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: errorCodeSchema,
    message: z.string().min(1).max(500),
    request_id: requestIdSchema,
    fields: fieldErrorsSchema.default({}),
  }),
})

export type ApiError = z.infer<typeof apiErrorSchema>

export const cursorSchema = z.string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/u)

export const paginationRequestSchema = z.strictObject({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const pageInfoSchema = z.strictObject({
  next_cursor: cursorSchema.nullable(),
  has_more: z.boolean(),
})

export function cursorPageSchema<Item extends z.ZodType>(item: Item) {
  return z.strictObject({
    items: z.array(item),
    page: pageInfoSchema,
  })
}

export { resourceVersionSchema } from './common-types'

export const idempotencyKeySchema = z.string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u)

export function versionedResourceSchema<Resource extends z.ZodRawShape>(resource: Resource) {
  return z.strictObject({
    ...resource,
    version: resourceVersionSchema,
  })
}

export function entityTagForVersion(version: number): string {
  return `"${resourceVersionSchema.parse(version)}"`
}

export function versionFromIfMatch(value: string | undefined): number | null {
  if (!value) return null
  const match = /^"([1-9]\d*)"$/u.exec(value)
  if (!match) return null

  const version = Number(match[1])
  const result = resourceVersionSchema.safeParse(version)
  return result.success ? result.data : null
}
