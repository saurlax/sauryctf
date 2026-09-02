import { z } from 'zod'
import { utcTimestampSchema, uuidSchema } from './common-types'

export const operationalCommandKindSchema = z.enum([
  'cache_rebuild',
  'dead_letter_replay',
  'instance_reconcile',
  'session_invalidate',
  'result_recalculate',
])

export const executeOperationalCommandRequestSchema = z.strictObject({
  kind: operationalCommandKindSchema,
  target_id: uuidSchema,
  reason: z.string().trim().min(10).max(1_000),
  confirmed: z.literal(true),
})

const operationalResultValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const operationalCommandSchema = z.strictObject({
  id: uuidSchema,
  kind: operationalCommandKindSchema,
  target_id: uuidSchema,
  status: z.literal('succeeded'),
  replayed: z.boolean(),
  completed_at: utcTimestampSchema,
  result: z.record(z.string(), operationalResultValueSchema),
})

export const executeOperationalCommandResponseSchema = z.strictObject({
  command: operationalCommandSchema,
})

export type OperationalCommandKind = z.infer<typeof operationalCommandKindSchema>
export type ExecuteOperationalCommandRequest = z.infer<typeof executeOperationalCommandRequestSchema>
export type OperationalCommand = z.infer<typeof operationalCommandSchema>
export type OperationalCommandResult = OperationalCommand['result']
