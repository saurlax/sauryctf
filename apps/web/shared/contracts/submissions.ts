import { z } from 'zod'
import { cursorPageSchema, paginationRequestSchema } from './http'
import { scoreSchema, utcTimestampSchema, uuidSchema } from './common-types'

export const submitFlagRequestSchema = z.strictObject({
  flag: z.string().min(1).max(1024),
})

export const submitFlagResponseSchema = z.strictObject({
  result: z.enum(['correct', 'incorrect', 'already_solved']),
  mode: z.enum(['official', 'practice']),
})

export const managedSubmissionSchema = z.strictObject({
  id: uuidSchema,
  contest_id: uuidSchema,
  challenge_id: uuidSchema,
  participation_id: uuidSchema,
  user_id: uuidSchema,
  mode: z.enum(['official', 'practice']),
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

export const cheatClueStatusSchema = z.enum(['open', 'reviewing', 'dismissed', 'confirmed'])
export const cheatClueReviewStatusSchema = z.enum(['reviewing', 'dismissed', 'confirmed'])
const answerFingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/u)
const cheatClueBase = {
  id: uuidSchema,
  contest_id: uuidSchema,
  challenge_id: uuidSchema.nullable(),
  participation_id: uuidSchema.nullable(),
  status: cheatClueStatusSchema,
  reviewed_by: uuidSchema.nullable(),
  review_note: z.string().max(1000).nullable(),
  reviewed_at: utcTimestampSchema.nullable(),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
}

const repeatedIncorrectAnswerEvidenceSchema = z.strictObject({
  schema: z.literal('cheat-clue.v1'),
  kind: z.literal('repeated_incorrect_answer'),
  answer_fingerprint: answerFingerprintSchema,
  trigger_submission_id: uuidSchema,
  participation_id: uuidSchema,
  challenge_id: uuidSchema,
  mode: z.literal('official'),
  matching_submission_count: z.number().int().min(3),
  first_seen_at: utcTimestampSchema,
  last_seen_at: utcTimestampSchema,
})

const sharedIncorrectAnswerEvidenceSchema = z.strictObject({
  schema: z.literal('cheat-clue.v1'),
  kind: z.literal('shared_incorrect_answer'),
  answer_fingerprint: answerFingerprintSchema,
  trigger_submission_id: uuidSchema,
  subject_submission_id: uuidSchema,
  participation_id: uuidSchema,
  related_participation_ids: z.array(uuidSchema).min(2),
  challenge_id: uuidSchema,
  mode: z.literal('official'),
  matching_participation_count: z.number().int().min(2),
  observed_at: utcTimestampSchema,
})

const abnormalSubmissionFrequencyEvidenceSchema = z.strictObject({
  schema: z.literal('cheat-clue.v1'),
  kind: z.literal('abnormal_submission_frequency'),
  trigger_submission_id: uuidSchema,
  participation_id: uuidSchema,
  challenge_id: uuidSchema,
  mode: z.literal('official'),
  matching_submission_count: z.number().int().min(10),
  window_started_at: utcTimestampSchema,
  window_ended_at: utcTimestampSchema,
})

const foreignTeamFlagEvidenceSchema = z.strictObject({
  schema: z.literal('cheat-clue.v1'),
  kind: z.literal('foreign_team_flag'),
  answer_fingerprint: answerFingerprintSchema,
  incorrect_submission_id: uuidSchema,
  owner_submission_id: uuidSchema,
  participation_id: uuidSchema,
  owner_participation_id: uuidSchema,
  challenge_id: uuidSchema,
  mode: z.literal('official'),
  observed_at: utcTimestampSchema,
})

export const cheatClueSchema = z.discriminatedUnion('clue_type', [
  z.strictObject({
    ...cheatClueBase,
    clue_type: z.literal('repeated_incorrect_answer'),
    evidence: repeatedIncorrectAnswerEvidenceSchema,
  }),
  z.strictObject({
    ...cheatClueBase,
    clue_type: z.literal('shared_incorrect_answer'),
    evidence: sharedIncorrectAnswerEvidenceSchema,
  }),
  z.strictObject({
    ...cheatClueBase,
    clue_type: z.literal('abnormal_submission_frequency'),
    evidence: abnormalSubmissionFrequencyEvidenceSchema,
  }),
  z.strictObject({
    ...cheatClueBase,
    clue_type: z.literal('foreign_team_flag'),
    evidence: foreignTeamFlagEvidenceSchema,
  }),
])

export const cheatClueListRequestSchema = paginationRequestSchema.extend({
  status: cheatClueStatusSchema.optional(),
})
export const cheatClueListResponseSchema = cursorPageSchema(cheatClueSchema)

export const reviewCheatClueRequestSchema = z.strictObject({
  status: cheatClueReviewStatusSchema,
  review_note: z.string().trim().max(1000).nullable().optional(),
})

export const reviewCheatClueResponseSchema = z.strictObject({
  clue: cheatClueSchema,
})

export type SubmitFlagRequest = z.infer<typeof submitFlagRequestSchema>
export type SubmitFlagResponse = z.infer<typeof submitFlagResponseSchema>
export type ManagedSubmission = z.infer<typeof managedSubmissionSchema>
export type RecordScoreAdjustmentRequest = z.infer<typeof recordScoreAdjustmentRequestSchema>
export type ScoreAdjustment = z.infer<typeof scoreAdjustmentSchema>
export type CheatClue = z.infer<typeof cheatClueSchema>
export type CheatClueStatus = z.infer<typeof cheatClueStatusSchema>
export type ReviewCheatClueRequest = z.infer<typeof reviewCheatClueRequestSchema>
