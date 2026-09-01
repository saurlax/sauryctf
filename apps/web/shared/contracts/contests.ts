import { z } from 'zod'
import { resourceVersionSchema, utcTimestampSchema, uuidSchema } from './common-types'

export const contestPublicationStatusSchema = z.enum(['draft', 'published', 'archived'])
export const contestTimePhaseSchema = z.enum(['upcoming', 'running', 'ended'])

export const contestSchema = z.strictObject({
  id: uuidSchema,
  title: z.string().min(1).max(160),
  slug: z.string().min(1).max(100),
  description: z.string(),
  publication_status: contestPublicationStatusSchema,
  phase: contestTimePhaseSchema.nullable(),
  start_at: utcTimestampSchema,
  end_at: utcTimestampSchema,
  published_at: utcTimestampSchema.nullable(),
  archived_at: utcTimestampSchema.nullable(),
  version: resourceVersionSchema,
})

export const createContestDraftRequestSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  description: z.string().max(100_000).default(''),
  start_at: utcTimestampSchema,
  end_at: utcTimestampSchema,
})

export const contestLifecycleRequestSchema = z.strictObject({
  reason: z.string().trim().min(3).max(1000),
})

export const contestResponseSchema = z.strictObject({ contest: contestSchema })

export type Contest = z.infer<typeof contestSchema>
export type CreateContestDraftRequest = z.infer<typeof createContestDraftRequestSchema>
