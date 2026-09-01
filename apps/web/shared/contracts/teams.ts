import { z } from 'zod'
import { resourceVersionSchema, utcTimestampSchema, uuidSchema } from './common-types'

export const teamMemberRoleSchema = z.enum(['member', 'captain'])
export const teamMemberSchema = z.strictObject({
  user_id: uuidSchema,
  username: z.string().min(1).max(64),
  role: teamMemberRoleSchema,
  joined_at: utcTimestampSchema,
})
export const teamLockContestSchema = z.strictObject({
  id: uuidSchema,
  title: z.string().min(1).max(160),
  start_at: utcTimestampSchema,
  end_at: utcTimestampSchema,
})
export const teamLockSchema = z.strictObject({
  locked: z.boolean(),
  contests: z.array(teamLockContestSchema),
})
export const teamSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().min(1).max(80),
  version: resourceVersionSchema,
  members: z.array(teamMemberSchema),
  invite_code: z.string().min(32).max(512).nullable(),
  lock: teamLockSchema,
})
export const teamResponseSchema = z.strictObject({ team: teamSchema.nullable() })
export const createTeamRequestSchema = z.strictObject({ name: z.string().trim().min(2).max(80) })
export const joinTeamRequestSchema = z.strictObject({ invite_code: z.string().min(32).max(512) })
export const transferCaptainRequestSchema = z.strictObject({ user_id: uuidSchema })
export const teamMutationResponseSchema = z.strictObject({ team: teamSchema })
export const teamLeftResponseSchema = z.strictObject({ left: z.literal(true) })
export const memberRemovedResponseSchema = z.strictObject({ removed: z.literal(true) })
export const inviteRotatedResponseSchema = z.strictObject({ invite_code: z.string().min(32).max(512) })
export const adminTeamCorrectionOperationSchema = z.enum(['add_member', 'remove_member', 'transfer_captain'])
export const adminTeamCorrectionRequestSchema = z.strictObject({
  operation: adminTeamCorrectionOperationSchema,
  user_id: uuidSchema,
  reason: z.string().trim().min(10).max(1000),
  confirm: z.literal(true),
})

export type Team = z.infer<typeof teamSchema>
export type TeamMember = z.infer<typeof teamMemberSchema>
export type TeamLockContest = z.infer<typeof teamLockContestSchema>
export type AdminTeamCorrectionOperation = z.infer<typeof adminTeamCorrectionOperationSchema>
