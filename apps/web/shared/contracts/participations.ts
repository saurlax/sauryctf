import { z } from 'zod'
import { resourceVersionSchema, utcTimestampSchema, uuidSchema } from './common-types'
import { cursorPageSchema } from './http'
import { teamMemberRoleSchema } from './teams'
import { contestInviteCodeSchema } from './contests'

export const participationStatusSchema = z.enum(['pending', 'accepted', 'rejected', 'withdrawn'])

export const participationTeamSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().min(1).max(80),
})

export const participationDivisionSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().min(1).max(80),
})

export const participationSchema = z.strictObject({
  id: uuidSchema,
  contest_id: uuidSchema,
  team: participationTeamSchema,
  division: participationDivisionSchema.nullable(),
  status: participationStatusSchema,
  registered_at: utcTimestampSchema,
  reviewed_at: utcTimestampSchema.nullable(),
  review_reason: z.string().nullable(),
  withdrawn_at: utcTimestampSchema.nullable(),
  version: resourceVersionSchema,
})

export const currentParticipationResponseSchema = z.strictObject({
  team: participationTeamSchema.extend({ role: teamMemberRoleSchema }).nullable(),
  participation: participationSchema.nullable(),
})

export const registerParticipationRequestSchema = z.strictObject({
  invite_code: contestInviteCodeSchema.optional(),
})

export const participationMutationResponseSchema = z.strictObject({
  participation: participationSchema,
})

export const reviewParticipationRequestSchema = z.strictObject({
  decision: z.enum(['accepted', 'rejected']),
  reason: z.string().trim().min(3).max(1000),
})

export const assignParticipationDivisionRequestSchema = z.strictObject({
  division_id: uuidSchema.nullable(),
  reason: z.string().trim().min(3).max(1000).optional(),
})

export const adminParticipationListRequestSchema = z.strictObject({
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: participationStatusSchema.optional(),
})

export const adminParticipationListResponseSchema = cursorPageSchema(participationSchema)

export type ParticipationStatus = z.infer<typeof participationStatusSchema>
export type Participation = z.infer<typeof participationSchema>
export type ReviewParticipationRequest = z.infer<typeof reviewParticipationRequestSchema>
