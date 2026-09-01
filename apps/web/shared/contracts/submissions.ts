import { z } from 'zod'
import { cursorPageSchema, paginationRequestSchema } from './http'
import { scoreSchema, utcTimestampSchema, uuidSchema } from './common-types'

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

export const recordScoreAdjustmentRequestSchema = z.strictObject({
  participation_id: uuidSchema,
  points_delta: scoreSchema.min(-1_000_000).max(1_000_000).refine(value => value !== 0, {
    message: '成绩调整分值不得为零',
  }),
  reason: z.string().trim().min(10).max(1000),
  confirm: z.literal(true),
})

export const scoreAdjustmentSchema = z.strictObject({
  id: uuidSchema,
  contest_id: uuidSchema,
  participation_id: uuidSchema,
  points_delta: scoreSchema,
  reason: z.string().min(1).max(1000),
  created_by: uuidSchema,
  request_id: z.string().min(1).max(128),
  created_at: utcTimestampSchema,
})

export const recordScoreAdjustmentResponseSchema = z.strictObject({
  adjustment: scoreAdjustmentSchema,
})

export type SubmitFlagRequest = z.infer<typeof submitFlagRequestSchema>
export type SubmitFlagResponse = z.infer<typeof submitFlagResponseSchema>
export type ManagedSubmission = z.infer<typeof managedSubmissionSchema>
export type RecordScoreAdjustmentRequest = z.infer<typeof recordScoreAdjustmentRequestSchema>
export type ScoreAdjustment = z.infer<typeof scoreAdjustmentSchema>
