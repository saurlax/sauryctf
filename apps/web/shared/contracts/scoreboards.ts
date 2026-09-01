import { z } from 'zod'
import {
  maxSafeContractInteger,
  scoreSchema,
  utcTimestampSchema,
  uuidSchema,
} from './common-types'

export const scoreboardVersionSchema = z.number()
  .int()
  .min(0)
  .max(maxSafeContractInteger)

export const scoreboardQuerySchema = z.strictObject({
  division_id: uuidSchema.optional(),
})

export const scoreboardScopeSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('overall') }),
  z.strictObject({ type: z.literal('division'), division_id: uuidSchema }),
])

export const scoreboardChallengeSchema = z.strictObject({
  challenge_id: uuidSchema,
  official_solve_count: z.number().int().min(0).max(maxSafeContractInteger),
  current_points: z.number().int().min(0).max(maxSafeContractInteger),
  first_solve_participation_id: uuidSchema.nullable(),
})

export const scoreboardSolveSchema = z.strictObject({
  solve_id: uuidSchema,
  challenge_id: uuidSchema,
  solved_at: utcTimestampSchema,
})

export const scoreboardRowSchema = z.strictObject({
  rank: z.number().int().positive().max(maxSafeContractInteger),
  participation_id: uuidSchema,
  team_id: uuidSchema,
  team_name: z.string().min(1).max(128),
  division_id: uuidSchema.nullable(),
  total_points: scoreSchema,
  solve_points: scoreSchema,
  adjustment_points: scoreSchema,
  official_solve_count: z.number().int().min(0).max(maxSafeContractInteger),
  last_scoring_at: utcTimestampSchema.nullable(),
  solves: z.array(scoreboardSolveSchema),
})

export const scoreboardResponseSchema = z.strictObject({
  scoreboard: z.strictObject({
    schema: z.literal('scoreboard-projection.v1'),
    contest_id: uuidSchema,
    view: z.enum(['public', 'internal']),
    state: z.enum(['live', 'frozen', 'settled']),
    freshness: z.enum(['current', 'stale']),
    version: scoreboardVersionSchema,
    frozen_at: utcTimestampSchema.nullable(),
    built_at: utcTimestampSchema,
    scope: scoreboardScopeSchema,
    challenges: z.array(scoreboardChallengeSchema),
    rows: z.array(scoreboardRowSchema),
  }),
})

export type ScoreboardResponse = z.infer<typeof scoreboardResponseSchema>
