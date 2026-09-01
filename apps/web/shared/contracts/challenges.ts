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

const versionFields = {
  title: z.string().trim().min(1).max(160),
  category: challengeCategorySchema,
  description: z.string().trim().min(1).max(100_000),
  flag_format: z.string().trim().min(1).max(160).nullable(),
  flag_policy: policySchema,
  scoring_policy: policySchema,
  instance_policy: policySchema,
  assets: z.array(challengeTemplateAssetInputSchema).max(100),
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
export type ChallengeTemplate = z.infer<typeof challengeTemplateSchema>
export type ChallengeTemplateVersion = z.infer<typeof challengeTemplateVersionSchema>
