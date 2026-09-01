import { z } from 'zod'
import { resourceVersionSchema, utcTimestampSchema, uuidSchema } from './common-types'

export const contestPublicationStatusSchema = z.enum(['draft', 'published', 'archived'])
export const contestTimePhaseSchema = z.enum(['upcoming', 'running', 'ended'])
export const contestVisibilitySchema = z.enum(['public', 'private'])
export const contestRegistrationStrategySchema = z.enum(['review', 'auto_accept'])

export const contestInviteCodeSchema = z.string()
  .trim()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u)

export const contestEmailDomainSchema = z.string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u)

export const contestRegistrationConstraintsSchema = z.strictObject({
  allowed_email_domains: z.array(contestEmailDomainSchema).max(100).default([]),
})

const contestConfigurationShape = {
  title: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  description: z.string().max(100_000),
  visibility: contestVisibilitySchema,
  invite_required: z.boolean(),
  invite_code: contestInviteCodeSchema.optional(),
  registration_strategy: contestRegistrationStrategySchema,
  start_at: utcTimestampSchema,
  end_at: utcTimestampSchema,
  scoreboard_freeze_at: utcTimestampSchema.nullable(),
  practice_enabled: z.boolean(),
  writeup_required: z.boolean(),
  writeup_deadline_at: utcTimestampSchema.nullable(),
  min_team_size: z.number().int().min(1).max(100),
  max_team_size: z.number().int().min(1).max(100),
  registration_constraints: contestRegistrationConstraintsSchema,
} as const

function validateConfiguration(
  configuration: {
    invite_required: boolean
    invite_code?: string
    start_at: string
    end_at: string
    scoreboard_freeze_at: string | null
    writeup_required: boolean
    writeup_deadline_at: string | null
    min_team_size: number
    max_team_size: number
  },
  context: z.RefinementCtx,
) {
  const startAt = Date.parse(configuration.start_at)
  const endAt = Date.parse(configuration.end_at)
  if (endAt <= startAt) {
    context.addIssue({ code: 'custom', path: ['end_at'], message: '结束时间必须晚于开始时间' })
  }
  if (configuration.scoreboard_freeze_at !== null) {
    const freezeAt = Date.parse(configuration.scoreboard_freeze_at)
    if (freezeAt < startAt || freezeAt > endAt) {
      context.addIssue({ code: 'custom', path: ['scoreboard_freeze_at'], message: '封榜时间必须位于比赛时间窗口内' })
    }
  }
  if (configuration.writeup_deadline_at !== null) {
    if (!configuration.writeup_required) {
      context.addIssue({ code: 'custom', path: ['writeup_deadline_at'], message: '未要求 Writeup 时不能设置截止时间' })
    }
    else if (Date.parse(configuration.writeup_deadline_at) < endAt) {
      context.addIssue({ code: 'custom', path: ['writeup_deadline_at'], message: 'Writeup 截止时间不得早于比赛结束时间' })
    }
  }
  if (configuration.min_team_size > configuration.max_team_size) {
    context.addIssue({ code: 'custom', path: ['max_team_size'], message: '队伍人数上限不得小于下限' })
  }
  if (configuration.invite_required && !configuration.invite_code) {
    context.addIssue({ code: 'custom', path: ['invite_code'], message: '启用邀请码要求时必须设置邀请码' })
  }
}

export const contestSchema = z.strictObject({
  id: uuidSchema,
  title: z.string().min(1).max(160),
  slug: z.string().min(1).max(100),
  description: z.string(),
  publication_status: contestPublicationStatusSchema,
  phase: contestTimePhaseSchema.nullable(),
  visibility: contestVisibilitySchema,
  invite_required: z.boolean(),
  invite_configured: z.boolean(),
  registration_strategy: contestRegistrationStrategySchema,
  start_at: utcTimestampSchema,
  end_at: utcTimestampSchema,
  scoreboard_freeze_at: utcTimestampSchema.nullable(),
  practice_enabled: z.boolean(),
  writeup_required: z.boolean(),
  writeup_deadline_at: utcTimestampSchema.nullable(),
  min_team_size: z.number().int().min(1).max(100),
  max_team_size: z.number().int().min(1).max(100),
  registration_constraints: contestRegistrationConstraintsSchema,
  published_at: utcTimestampSchema.nullable(),
  archived_at: utcTimestampSchema.nullable(),
  version: resourceVersionSchema,
})

export const createContestDraftRequestSchema = z.strictObject({
  ...contestConfigurationShape,
  description: contestConfigurationShape.description.default(''),
  visibility: contestConfigurationShape.visibility.default('public'),
  invite_required: contestConfigurationShape.invite_required.default(false),
  registration_strategy: contestConfigurationShape.registration_strategy.default('review'),
  scoreboard_freeze_at: contestConfigurationShape.scoreboard_freeze_at.default(null),
  practice_enabled: contestConfigurationShape.practice_enabled.default(false),
  writeup_required: contestConfigurationShape.writeup_required.default(false),
  writeup_deadline_at: contestConfigurationShape.writeup_deadline_at.default(null),
  min_team_size: contestConfigurationShape.min_team_size.default(1),
  max_team_size: contestConfigurationShape.max_team_size.default(5),
  registration_constraints: contestConfigurationShape.registration_constraints.default({
    allowed_email_domains: [],
  }),
}).superRefine(validateConfiguration)

export const updateContestDraftRequestSchema = z.strictObject({
  title: contestConfigurationShape.title.optional(),
  slug: contestConfigurationShape.slug.optional(),
  description: contestConfigurationShape.description.optional(),
  visibility: contestConfigurationShape.visibility.optional(),
  invite_required: contestConfigurationShape.invite_required.optional(),
  invite_code: contestInviteCodeSchema.nullable().optional(),
  registration_strategy: contestConfigurationShape.registration_strategy.optional(),
  start_at: contestConfigurationShape.start_at.optional(),
  end_at: contestConfigurationShape.end_at.optional(),
  scoreboard_freeze_at: contestConfigurationShape.scoreboard_freeze_at.optional(),
  practice_enabled: contestConfigurationShape.practice_enabled.optional(),
  writeup_required: contestConfigurationShape.writeup_required.optional(),
  writeup_deadline_at: contestConfigurationShape.writeup_deadline_at.optional(),
  min_team_size: contestConfigurationShape.min_team_size.optional(),
  max_team_size: contestConfigurationShape.max_team_size.optional(),
  registration_constraints: contestConfigurationShape.registration_constraints.optional(),
  reason: z.string().trim().min(3).max(1000),
}).superRefine((input, context) => {
  if (Object.keys(input).every(key => key === 'reason')) {
    context.addIssue({ code: 'custom', path: ['request'], message: '至少需要修改一个比赛配置字段' })
  }
})

export const contestLifecycleRequestSchema = z.strictObject({
  reason: z.string().trim().min(3).max(1000),
})

export const contestResponseSchema = z.strictObject({ contest: contestSchema })

export type Contest = z.infer<typeof contestSchema>
export type CreateContestDraftRequest = z.infer<typeof createContestDraftRequestSchema>
export type UpdateContestDraftRequest = z.infer<typeof updateContestDraftRequestSchema>
export type ContestPublicationStatus = z.infer<typeof contestPublicationStatusSchema>
export type ContestTimePhase = z.infer<typeof contestTimePhaseSchema>
export type ContestVisibility = z.infer<typeof contestVisibilitySchema>
export type ContestRegistrationStrategy = z.infer<typeof contestRegistrationStrategySchema>
