import { z } from 'zod'
import { resourceVersionSchema, utcTimestampSchema, uuidSchema } from './common-types'

export const teamMemberRoleSchema = z.enum(['member', 'captain'])
export const teamMemberSchema = z.strictObject({
  user_id: uuidSchema,
  username: z.string().min(1).max(64),
  role: teamMemberRoleSchema,
  joined_at: utcTimestampSchema,
})
export const teamSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().min(1).max(80),
  version: resourceVersionSchema,
  members: z.array(teamMemberSchema),
  invite_code: z.string().min(32).max(512).nullable(),
})
export const teamResponseSchema = z.strictObject({ team: teamSchema.nullable() })
export const createTeamRequestSchema = z.strictObject({ name: z.string().trim().min(2).max(80) })
export const joinTeamRequestSchema = z.strictObject({ invite_code: z.string().min(32).max(512) })
export const transferCaptainRequestSchema = z.strictObject({ user_id: uuidSchema })
export const teamMutationResponseSchema = z.strictObject({ team: teamSchema })
export const teamLeftResponseSchema = z.strictObject({ left: z.literal(true) })
export const memberRemovedResponseSchema = z.strictObject({ removed: z.literal(true) })
export const inviteRotatedResponseSchema = z.strictObject({ invite_code: z.string().min(32).max(512) })

export type Team = z.infer<typeof teamSchema>
export type TeamMember = z.infer<typeof teamMemberSchema>
