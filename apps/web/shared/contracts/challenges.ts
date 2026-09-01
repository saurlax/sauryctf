import { z } from 'zod'
import { resourceVersionSchema, utcTimestampSchema, uuidSchema } from './common-types'

export const challengeCategorySchema = z.enum([
  'web',
  'pwn',
  'crypto',
  'reverse',
  'misc',
  'forensics',
])

const policySchema = z.record(z.string(), z.unknown())

export const challengeTemplateAssetInputSchema = z.strictObject({
  content_object_id: uuidSchema,
  display_name: z.string().trim().min(1).max(255),
  sort_order: z.number().int().min(0).max(10_000).default(0),
})

export const challengeTemplateAssetSchema = challengeTemplateAssetInputSchema.extend({
  id: uuidSchema,
})

export const challengeTemplateHintInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(100_000),
  release_after_seconds: z.number().int().min(0).max(31_536_000).nullable().default(null),
  sort_order: z.number().int().min(0).max(10_000).default(0),
})

export const challengeTemplateHintSchema = challengeTemplateHintInputSchema.extend({
  id: uuidSchema,
})

const versionFields = {
  title: z.string().trim().min(1).max(160),
  category: challengeCategorySchema,
  description: z.string().trim().min(1).max(100_000),
  flag_format: z.string().trim().min(1).max(160).nullable(),
  flag_policy: policySchema,
  scoring_policy: policySchema,
  instance_policy: policySchema,
  assets: z.array(challengeTemplateAssetInputSchema).max(100),
  hints: z.array(challengeTemplateHintInputSchema).max(100),
} as const

function uniqueAssets(
  input: { assets?: Array<{ content_object_id: string }> },
  context: z.RefinementCtx,
) {
  const seen = new Set<string>()
  for (const [index, asset] of (input.assets ?? []).entries()) {
    if (seen.has(asset.content_object_id)) {
      context.addIssue({
        code: 'custom',
        path: ['assets', index, 'content_object_id'],
        message: '同一内容对象不能在一个题目版本中重复引用',
      })
    }
    seen.add(asset.content_object_id)
  }
}

export const createChallengeTemplateRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  ...versionFields,
  flag_format: versionFields.flag_format.default(null),
  instance_policy: versionFields.instance_policy.default({ type: 'none' }),
  assets: versionFields.assets.default([]),
  hints: versionFields.hints.default([]),
}).superRefine(uniqueAssets)

export const createChallengeTemplateVersionRequestSchema = z.strictObject({
  title: versionFields.title.optional(),
  category: versionFields.category.optional(),
  description: versionFields.description.optional(),
  flag_format: versionFields.flag_format.optional(),
  flag_policy: versionFields.flag_policy.optional(),
  scoring_policy: versionFields.scoring_policy.optional(),
  instance_policy: versionFields.instance_policy.optional(),
  assets: versionFields.assets.optional(),
  hints: versionFields.hints.optional(),
  reason: z.string().trim().min(3).max(1000),
}).superRefine((input, context) => {
  uniqueAssets(input, context)
  if (Object.keys(input).every(key => key === 'reason')) {
    context.addIssue({ code: 'custom', path: ['request'], message: '至少需要修改一个题目版本字段' })
  }
})

export const challengeTemplateVersionSchema = z.strictObject({
  id: uuidSchema,
  template_id: uuidSchema,
  version_number: z.number().int().positive(),
  title: versionFields.title,
  category: versionFields.category,
  description: versionFields.description,
  flag_format: versionFields.flag_format,
  flag_policy: versionFields.flag_policy,
  scoring_policy: versionFields.scoring_policy,
  instance_policy: versionFields.instance_policy,
  assets: z.array(challengeTemplateAssetSchema),
  hints: z.array(challengeTemplateHintSchema),
  created_by: uuidSchema,
  created_at: utcTimestampSchema,
})

export const challengeTemplateSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().min(1).max(160),
  slug: z.string().min(1).max(100),
  latest_version: z.number().int().positive(),
  version: resourceVersionSchema,
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
})

export const challengeTemplateResponseSchema = z.strictObject({
  template: challengeTemplateSchema,
  challenge_version: challengeTemplateVersionSchema,
})

export type ChallengeCategory = z.infer<typeof challengeCategorySchema>
export type ChallengeTemplateAssetInput = z.infer<typeof challengeTemplateAssetInputSchema>
export type ChallengeTemplateHintInput = z.infer<typeof challengeTemplateHintInputSchema>
export type ChallengeTemplate = z.infer<typeof challengeTemplateSchema>
export type ChallengeTemplateVersion = z.infer<typeof challengeTemplateVersionSchema>

export const contestChallengeAssetInputSchema = challengeTemplateAssetInputSchema

export const contestChallengeAssetSchema = contestChallengeAssetInputSchema.extend({
  id: uuidSchema,
})

export const contestChallengeHintInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(100_000),
  release_at: utcTimestampSchema.nullable(),
  sort_order: z.number().int().min(0).max(10_000).default(0),
})

export const contestChallengeHintSchema = contestChallengeHintInputSchema.extend({
  id: uuidSchema,
})

const contestDeliveryFields = {
  enabled: z.boolean(),
  publish_at: utcTimestampSchema.nullable(),
  close_at: utcTimestampSchema.nullable(),
  submission_limit: z.number().int().positive().max(1_000_000).nullable(),
  sort_order: z.number().int().min(0).max(10_000),
} as const

function validPublicationWindow(
  input: { publish_at?: string | null, close_at?: string | null },
  context: z.RefinementCtx,
) {
  if (input.publish_at && input.close_at && input.close_at <= input.publish_at) {
    context.addIssue({
      code: 'custom',
      path: ['close_at'],
      message: '题目截止时间必须晚于发布时间',
    })
  }
}

export const mountContestChallengeRequestSchema = z.strictObject({
  template_version_id: uuidSchema,
  enabled: contestDeliveryFields.enabled.default(false),
  publish_at: contestDeliveryFields.publish_at.default(null),
  close_at: contestDeliveryFields.close_at.default(null),
  submission_limit: contestDeliveryFields.submission_limit.default(null),
  sort_order: contestDeliveryFields.sort_order.default(0),
}).superRefine(validPublicationWindow)

const contestSnapshotRevisionFields = {
  title: versionFields.title,
  category: versionFields.category,
  description: versionFields.description,
  flag_format: versionFields.flag_format,
  flag_policy: versionFields.flag_policy,
  scoring_policy: versionFields.scoring_policy,
  instance_policy: versionFields.instance_policy,
  assets: z.array(contestChallengeAssetInputSchema).max(100),
  hints: z.array(contestChallengeHintInputSchema).max(100),
  ...contestDeliveryFields,
} as const

export const reviseContestChallengeRequestSchema = z.strictObject({
  title: contestSnapshotRevisionFields.title.optional(),
  category: contestSnapshotRevisionFields.category.optional(),
  description: contestSnapshotRevisionFields.description.optional(),
  flag_format: contestSnapshotRevisionFields.flag_format.optional(),
  flag_policy: contestSnapshotRevisionFields.flag_policy.optional(),
  scoring_policy: contestSnapshotRevisionFields.scoring_policy.optional(),
  instance_policy: contestSnapshotRevisionFields.instance_policy.optional(),
  assets: contestSnapshotRevisionFields.assets.optional(),
  hints: contestSnapshotRevisionFields.hints.optional(),
  enabled: contestSnapshotRevisionFields.enabled.optional(),
  publish_at: contestSnapshotRevisionFields.publish_at.optional(),
  close_at: contestSnapshotRevisionFields.close_at.optional(),
  submission_limit: contestSnapshotRevisionFields.submission_limit.optional(),
  sort_order: contestSnapshotRevisionFields.sort_order.optional(),
  reason: z.string().trim().min(3).max(1000),
}).superRefine((input, context) => {
  validPublicationWindow(input, context)
  if (Object.keys(input).every(key => key === 'reason')) {
    context.addIssue({ code: 'custom', path: ['request'], message: '至少需要修改一个比赛题目快照字段' })
  }
  uniqueAssets(input, context)
})

export const contestChallengeSchema = z.strictObject({
  id: uuidSchema,
  contest_id: uuidSchema,
  source_template_id: uuidSchema,
  source_version_id: uuidSchema,
  source_version_number: z.number().int().positive(),
  snapshot_revision: z.number().int().positive(),
  title: contestSnapshotRevisionFields.title,
  category: contestSnapshotRevisionFields.category,
  description: contestSnapshotRevisionFields.description,
  flag_format: contestSnapshotRevisionFields.flag_format,
  flag_policy: contestSnapshotRevisionFields.flag_policy,
  scoring_policy: contestSnapshotRevisionFields.scoring_policy,
  instance_policy: contestSnapshotRevisionFields.instance_policy,
  assets: z.array(contestChallengeAssetSchema),
  hints: z.array(contestChallengeHintSchema),
  enabled: contestSnapshotRevisionFields.enabled,
  publish_at: contestSnapshotRevisionFields.publish_at,
  close_at: contestSnapshotRevisionFields.close_at,
  submission_limit: contestSnapshotRevisionFields.submission_limit,
  sort_order: contestSnapshotRevisionFields.sort_order,
  version: resourceVersionSchema,
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
})

export const contestChallengeResponseSchema = z.strictObject({
  challenge: contestChallengeSchema,
})

export type ContestChallenge = z.infer<typeof contestChallengeSchema>
