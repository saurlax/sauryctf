import { z } from 'zod'
import { resourceVersionSchema, utcTimestampSchema, uuidSchema } from './common-types'
import { instanceProviderSchema } from './instance-jobs'

export const instanceLifecycleStateSchema = z.enum([
  'pending',
  'starting',
  'running',
  'stopping',
  'stopped',
  'expired',
  'failed',
  'unknown',
])

export const instanceEntrypointSchema = z.strictObject({
  name: z.string().min(1).max(32).regex(/^[a-z][a-z0-9-]*$/u),
  protocol: z.enum(['http', 'tcp']),
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  url: z.url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol)).nullable().default(null),
}).superRefine((entrypoint, context) => {
  if (entrypoint.protocol === 'http' && entrypoint.url === null) {
    context.addIssue({ code: 'custom', path: ['url'], message: 'HTTP 入口必须包含公开 URL' })
  }
  if (entrypoint.protocol === 'tcp' && entrypoint.url !== null) {
    context.addIssue({ code: 'custom', path: ['url'], message: 'TCP 入口不得包含 URL' })
  }
})

export const instanceLeasePolicySchema = z.strictObject({
  initial_duration_seconds: z.number().int().positive(),
  extension_duration_seconds: z.number().int().positive(),
  renewal_window_seconds: z.number().int().positive(),
  team_active_limit: z.number().int().positive(),
})

export const playerInstanceSchema = z.strictObject({
  id: uuidSchema,
  contest_id: uuidSchema,
  contest_challenge_id: uuidSchema,
  participation_id: uuidSchema,
  provider: instanceProviderSchema,
  state: instanceLifecycleStateSchema,
  desired_generation: resourceVersionSchema,
  observed_generation: z.number().int().nonnegative(),
  expires_at: utcTimestampSchema.nullable(),
  renewable_at: utcTimestampSchema.nullable(),
  can_renew: z.boolean(),
  entrypoints: z.array(instanceEntrypointSchema).max(16),
  last_observed_at: utcTimestampSchema.nullable(),
  error: z.strictObject({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(1024),
  }).nullable(),
  version: resourceVersionSchema,
})

export const playerInstanceResponseSchema = z.strictObject({
  instance: playerInstanceSchema.nullable(),
  policy: instanceLeasePolicySchema,
})

export type InstanceLifecycleState = z.infer<typeof instanceLifecycleStateSchema>
export type InstanceEntrypoint = z.infer<typeof instanceEntrypointSchema>
export type InstanceLeasePolicy = z.infer<typeof instanceLeasePolicySchema>
export type PlayerInstance = z.infer<typeof playerInstanceSchema>
