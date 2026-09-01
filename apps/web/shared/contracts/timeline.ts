import { z } from 'zod'
import { contestTimePhaseSchema } from './contests'
import { utcTimestampSchema, uuidSchema } from './common-types'
import { cursorPageSchema, cursorSchema } from './http'

export const publicTimelineEventTypeSchema = z.enum([
  'announcement_published',
  'challenge_published',
  'hint_published',
  'first_solve',
  'scoreboard_frozen',
  'contest_phase_changed',
])

const eventIdentityShape = {
  id: z.string().min(1).max(200),
  occurred_at: utcTimestampSchema,
  visible_at: utcTimestampSchema,
} as const

export const publicTimelineEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...eventIdentityShape,
    type: z.literal('announcement_published'),
    payload: z.strictObject({
      announcement_id: uuidSchema,
      title: z.string().trim().min(1).max(200),
    }),
  }),
  z.strictObject({
    ...eventIdentityShape,
    type: z.literal('challenge_published'),
    payload: z.strictObject({
      challenge_id: uuidSchema,
      title: z.string().trim().min(1).max(160),
      category: z.enum(['web', 'pwn', 'crypto', 'reverse', 'misc', 'forensics']),
    }),
  }),
  z.strictObject({
    ...eventIdentityShape,
    type: z.literal('hint_published'),
    payload: z.strictObject({
      challenge_id: uuidSchema,
      hint_id: uuidSchema,
    }),
  }),
  z.strictObject({
    ...eventIdentityShape,
    type: z.literal('first_solve'),
    payload: z.strictObject({
      challenge_id: uuidSchema,
      team_id: uuidSchema,
      team_name: z.string().trim().min(1).max(80),
    }),
  }),
  z.strictObject({
    ...eventIdentityShape,
    type: z.literal('scoreboard_frozen'),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...eventIdentityShape,
    type: z.literal('contest_phase_changed'),
    payload: z.strictObject({
      phase: contestTimePhaseSchema,
    }),
  }),
])

export const publicTimelineListRequestSchema = z.strictObject({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const publicTimelineListResponseSchema = cursorPageSchema(publicTimelineEventSchema)

export type PublicTimelineEvent = z.infer<typeof publicTimelineEventSchema>
export type PublicTimelineEventType = z.infer<typeof publicTimelineEventTypeSchema>
