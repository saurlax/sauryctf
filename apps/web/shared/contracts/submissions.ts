import { z } from 'zod'
import { cursorPageSchema, paginationRequestSchema } from './http'
import { utcTimestampSchema, uuidSchema } from './common-types'

export const submitFlagRequestSchema = z.strictObject({
  flag: z.string().min(1).max(1024),
})

export const submitFlagResponseSchema = z.strictObject({
  result: z.enum(['correct', 'incorrect', 'already_solved']),
})

export const managedSubmissionSchema = z.strictObject({
  id: uuidSchema,
  contest_id: uuidSchema,
  challenge_id: uuidSchema,
  participation_id: uuidSchema,
  user_id: uuidSchema,
  mode: z.literal('official'),
  result: z.enum(['correct', 'incorrect', 'already_solved']),
  answer_masked: z.literal('••••••••'),
  submitted_at: utcTimestampSchema,
})

export const managedSubmissionListRequestSchema = paginationRequestSchema
export const managedSubmissionListResponseSchema = cursorPageSchema(managedSubmissionSchema)

export type SubmitFlagRequest = z.infer<typeof submitFlagRequestSchema>
export type SubmitFlagResponse = z.infer<typeof submitFlagResponseSchema>
export type ManagedSubmission = z.infer<typeof managedSubmissionSchema>
