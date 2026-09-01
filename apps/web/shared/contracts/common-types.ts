import { z } from 'zod'

export const maxSafeContractInteger = Number.MAX_SAFE_INTEGER

export const uuidSchema = z.uuid()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)

export type UUID = z.infer<typeof uuidSchema>

// Public timestamps deliberately use the precision that JavaScript Date can
// preserve. Database-only timestamptz values may retain finer precision until
// they cross the public contract boundary.
export const utcTimestampSchema = z.iso.datetime({ offset: false, precision: 3 })

export type UTCTimestamp = z.infer<typeof utcTimestampSchema>

export const scoreSchema = z.number()
  .int()
  .min(-maxSafeContractInteger)
  .max(maxSafeContractInteger)

export type Score = z.infer<typeof scoreSchema>

export const resourceVersionSchema = z.number()
  .int()
  .positive()
  .max(maxSafeContractInteger)

export type ResourceVersion = z.infer<typeof resourceVersionSchema>

export const commonTypesFixtureSchema = z.strictObject({
  id: uuidSchema,
  occurred_at: utcTimestampSchema,
  score: scoreSchema,
  version: resourceVersionSchema,
})

export type CommonTypesFixture = z.infer<typeof commonTypesFixtureSchema>

export function toUtcTimestamp(value: Date): UTCTimestamp {
  if (Number.isNaN(value.getTime())) throw new TypeError('Invalid Date cannot be converted to a UTC timestamp')
  return utcTimestampSchema.parse(value.toISOString())
}
