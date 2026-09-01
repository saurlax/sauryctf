import { z } from 'zod'
import { resourceVersionSchema } from './http'
import { utcTimestampSchema, uuidSchema } from './common-types'

export const publicRealtimeEventSchema = z.strictObject({
  schema: z.literal('public-realtime-event.v1'),
  id: uuidSchema,
  contestId: uuidSchema,
  type: z.literal('scoreboard.refresh'),
  version: resourceVersionSchema,
  occurredAt: utcTimestampSchema,
})

export const publicRealtimeResetSchema = z.strictObject({
  reason: z.literal('recovery_window_unavailable'),
})

export type PublicRealtimeEvent = z.infer<typeof publicRealtimeEventSchema>
