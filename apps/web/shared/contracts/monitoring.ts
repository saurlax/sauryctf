import { z } from 'zod'
import { utcTimestampSchema, uuidSchema } from './common-types'

export const monitoringKindSchema = z.enum([
  'submissions',
  'cheat_clues',
  'instances',
  'instance_jobs',
  'announcements',
  'notifications',
  'mail_deliveries',
  'writeups',
  'audit_events',
])

export const monitoringListRequestSchema = z.strictObject({
  kind: monitoringKindSchema.default('instances'),
  contest_id: uuidSchema.optional(),
  challenge_id: uuidSchema.optional(),
  team_id: uuidSchema.optional(),
  status: z.string().regex(/^[a-z][a-z0-9_]*$/u).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const monitoringDetailValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const monitoringItemSchema = z.strictObject({
  kind: monitoringKindSchema,
  id: uuidSchema,
  contest_id: uuidSchema.nullable(),
  challenge_id: uuidSchema.nullable(),
  team_id: uuidSchema.nullable(),
  status: z.string().min(1).max(128),
  fact_at: utcTimestampSchema,
  worker_observed_at: utcTimestampSchema.nullable(),
  worker_observation_stale: z.boolean(),
  details: z.record(z.string(), monitoringDetailValueSchema),
})

export const monitoringListResponseSchema = z.strictObject({
  generated_at: utcTimestampSchema,
  source: z.literal('postgresql'),
  data_services: z.strictObject({
    postgresql: z.strictObject({
      status: z.enum(['ready', 'unavailable']),
      migrations: z.enum(['current', 'unavailable']),
    }),
    blob: z.strictObject({
      driver: z.enum(['fs', 's3']),
      status: z.enum(['ready', 'unavailable']),
    }),
  }),
  worker_stale_after_seconds: z.number().int().positive(),
  items: z.array(monitoringItemSchema),
})

export type MonitoringKind = z.infer<typeof monitoringKindSchema>
export type MonitoringListRequest = z.infer<typeof monitoringListRequestSchema>
export type MonitoringItem = z.infer<typeof monitoringItemSchema>
export type MonitoringListResponse = z.infer<typeof monitoringListResponseSchema>
export type DataServicesHealth = MonitoringListResponse['data_services']
