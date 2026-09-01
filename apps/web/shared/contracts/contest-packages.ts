import { z } from 'zod'
import {
  challengeCategorySchema,
  challengeFlagPolicySchema,
  challengeInstancePolicySchema,
  challengeScoringPolicySchema,
} from './challenges'
import {
  contestRegistrationConstraintsSchema,
  contestRegistrationStrategySchema,
  contestVisibilitySchema,
} from './contests'
import { utcTimestampSchema, uuidSchema } from './common-types'

export const contestPackageFormat = 'sauryctf.jeopardy.v1' as const

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const packagePathSchema = z.string().min(1).max(512).regex(/^[a-zA-Z0-9._/-]+$/u)

export const contestPackageFileSchema = z.strictObject({
  path: packagePathSchema,
  sha256: sha256Schema,
  size_bytes: z.number().int().min(1).max(64 * 1024 * 1024),
  media_type: z.string().trim().min(1).max(255),
  filename: z.string().trim().min(1).max(255),
})

export const contestPackageAssetSchema = z.strictObject({
  path: packagePathSchema,
  display_name: z.string().trim().min(1).max(255),
  sort_order: z.number().int().min(0).max(10_000),
})

export const contestPackageHintSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(100_000),
  release_at: utcTimestampSchema.nullable(),
  sort_order: z.number().int().min(0).max(10_000),
})

export const contestPackageChallengeSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  category: challengeCategorySchema,
  description: z.string().trim().min(1).max(100_000),
  flag_format: z.string().trim().min(1).max(160).nullable(),
  flag_policy: challengeFlagPolicySchema,
  scoring_policy: challengeScoringPolicySchema,
  instance_policy: challengeInstancePolicySchema,
  assets: z.array(contestPackageAssetSchema).max(100),
  hints: z.array(contestPackageHintSchema).max(100),
  enabled: z.boolean(),
  publish_at: utcTimestampSchema.nullable(),
  close_at: utcTimestampSchema.nullable(),
  submission_limit: z.number().int().positive().max(1_000_000).nullable(),
  sort_order: z.number().int().min(0).max(10_000),
})

export const contestPackageDivisionSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  sort_order: z.number().int().min(0).max(10_000),
})

export const contestPackageManifestSchema = z.strictObject({
  format: z.literal(contestPackageFormat),
  compatibility: z.strictObject({
    minimum: z.literal('1.0.0'),
    maximum: z.literal('1.x'),
  }),
  exported_at: utcTimestampSchema,
  contest: z.strictObject({
    title: z.string().trim().min(1).max(160),
    slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    description: z.string().max(100_000),
    visibility: contestVisibilitySchema,
    registration_strategy: contestRegistrationStrategySchema,
    invite_required: z.boolean(),
    start_at: utcTimestampSchema,
    end_at: utcTimestampSchema,
    scoreboard_freeze_at: utcTimestampSchema.nullable(),
    practice_enabled: z.boolean(),
    writeup_required: z.boolean(),
    writeup_deadline_at: utcTimestampSchema.nullable(),
    min_team_size: z.number().int().min(1).max(100),
    max_team_size: z.number().int().min(1).max(100),
    registration_constraints: contestRegistrationConstraintsSchema,
    divisions: z.array(contestPackageDivisionSchema).max(100),
    challenges: z.array(contestPackageChallengeSchema).max(500),
  }),
  files: z.array(contestPackageFileSchema).max(1000),
}).superRefine((manifest, context) => {
  const paths = new Set<string>()
  for (const [index, file] of manifest.files.entries()) {
    if (paths.has(file.path)) {
      context.addIssue({ code: 'custom', path: ['files', index, 'path'], message: '文件路径不能重复' })
    }
    paths.add(file.path)
  }
  const titles = new Set<string>()
  const divisionNames = new Set<string>()
  for (const [divisionIndex, division] of manifest.contest.divisions.entries()) {
    const normalizedName = division.name.normalize('NFC').toLocaleLowerCase('en-US')
    if (divisionNames.has(normalizedName)) {
      context.addIssue({
        code: 'custom',
        path: ['contest', 'divisions', divisionIndex, 'name'],
        message: '分组名称不能重复',
      })
    }
    divisionNames.add(normalizedName)
  }
  for (const [challengeIndex, challenge] of manifest.contest.challenges.entries()) {
    const normalizedTitle = challenge.title.normalize('NFC').toLocaleLowerCase('en-US')
    if (titles.has(normalizedTitle)) {
      context.addIssue({
        code: 'custom',
        path: ['contest', 'challenges', challengeIndex, 'title'],
        message: '题目标题不能重复',
      })
    }
    titles.add(normalizedTitle)
    const assetPaths = new Set<string>()
    for (const [assetIndex, asset] of challenge.assets.entries()) {
      if (assetPaths.has(asset.path)) {
        context.addIssue({
          code: 'custom',
          path: ['contest', 'challenges', challengeIndex, 'assets', assetIndex, 'path'],
          message: '同一道题不能重复引用同一附件',
        })
      }
      assetPaths.add(asset.path)
      if (!paths.has(asset.path)) {
        context.addIssue({
          code: 'custom',
          path: ['contest', 'challenges', challengeIndex, 'assets', assetIndex, 'path'],
          message: '附件路径未在文件清单中声明',
        })
      }
    }
  }
  if (manifest.contest.end_at <= manifest.contest.start_at) {
    context.addIssue({ code: 'custom', path: ['contest', 'end_at'], message: '比赛结束时间必须晚于开始时间' })
  }
  if (manifest.contest.scoreboard_freeze_at
    && (manifest.contest.scoreboard_freeze_at < manifest.contest.start_at
      || manifest.contest.scoreboard_freeze_at > manifest.contest.end_at)) {
    context.addIssue({ code: 'custom', path: ['contest', 'scoreboard_freeze_at'], message: '封榜时间必须位于比赛窗口内' })
  }
  if (manifest.contest.writeup_deadline_at
    && manifest.contest.writeup_deadline_at < manifest.contest.end_at) {
    context.addIssue({ code: 'custom', path: ['contest', 'writeup_deadline_at'], message: 'Writeup 截止时间不得早于比赛结束时间' })
  }
  if (!manifest.contest.writeup_required && manifest.contest.writeup_deadline_at) {
    context.addIssue({ code: 'custom', path: ['contest', 'writeup_deadline_at'], message: '未启用 Writeup 时不能设置截止时间' })
  }
  if (manifest.contest.max_team_size < manifest.contest.min_team_size) {
    context.addIssue({ code: 'custom', path: ['contest', 'max_team_size'], message: '队伍人数上限不得小于下限' })
  }
})

export const createContestPackageExportRequestSchema = z.strictObject({
  reason: z.string().trim().min(3).max(1000),
})

export const importContestPackageRequestSchema = z.strictObject({
  package_object_id: uuidSchema,
  invite_code: z.string().trim().regex(/^[A-Za-z0-9._:-]{32,128}$/u).optional(),
  reason: z.string().trim().min(3).max(1000),
})

export const contestPackageExportSchema = z.strictObject({
  id: uuidSchema,
  contest_id: uuidSchema,
  package_object_id: uuidSchema,
  package_version: z.literal(contestPackageFormat),
  filename: z.string().min(1).max(255),
  sha256: sha256Schema,
  size_bytes: z.number().int().positive(),
  created_at: utcTimestampSchema,
})

export const contestPackageImportSchema = z.strictObject({
  id: uuidSchema,
  package_object_id: uuidSchema,
  package_version: z.literal(contestPackageFormat),
  contest_id: uuidSchema,
  created_at: utcTimestampSchema,
})

export const contestPackageExportResponseSchema = z.strictObject({ export: contestPackageExportSchema })
export const contestPackageImportResponseSchema = z.strictObject({ import: contestPackageImportSchema })

export type ContestPackageManifest = z.infer<typeof contestPackageManifestSchema>
export type ContestPackageFile = z.infer<typeof contestPackageFileSchema>
export type ContestPackageExport = z.infer<typeof contestPackageExportSchema>
export type ContestPackageImport = z.infer<typeof contestPackageImportSchema>
