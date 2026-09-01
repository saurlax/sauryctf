import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type {
  ChallengeCategory,
  ChallengeFlagPolicy,
  ChallengeInstancePolicy,
  ChallengeScoringPolicy,
} from '../../../shared/contracts/challenges'
import { identityCapability, requireIdentityCapability } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'
import { assertChallengePolicies, ChallengePolicyValidationError } from './policies'
import {
  ChallengeContentObjectUnavailableError,
  ChallengeTemplateNotFoundError,
  ChallengeTemplateSlugConflictError,
  ChallengeTemplateVersionConflictError,
  type ChallengeTemplateAssetCommand,
  type ChallengeTemplateHintCommand,
  type ChallengeTemplateDetail,
  type ChallengeTemplateRepository,
  type ChallengeVersionSnapshotCommand,
} from './repository'

export type ChallengeTemplateServiceErrorCode =
  | 'challenge.asset_unavailable'
  | 'challenge.template_not_found'
  | 'challenge.template_slug_conflict'
  | 'challenge.policy_invalid'
  | 'challenge.version_unchanged'
  | 'resource.version_conflict'

export class ChallengeTemplateServiceError extends Error {
  constructor(
    readonly code: ChallengeTemplateServiceErrorCode,
    readonly fields: Record<string, string[]> = {},
  ) {
    super({
      'challenge.asset_unavailable': '题目附件尚未处于可引用状态',
      'challenge.template_not_found': '题库模板或指定版本不存在',
      'challenge.template_slug_conflict': '题库模板路径标识已被使用',
      'challenge.policy_invalid': '题目策略配置无效',
      'challenge.version_unchanged': '题目版本内容没有变化',
      'resource.version_conflict': '资源版本冲突，请刷新后重试',
    }[code])
    this.name = 'ChallengeTemplateServiceError'
  }
}

interface VersionInput {
  title: string
  category: ChallengeCategory
  description: string
  flagFormat: string | null
  flagPolicy: ChallengeFlagPolicy
  scoringPolicy: ChallengeScoringPolicy
  instancePolicy: ChallengeInstancePolicy
  assets: ChallengeTemplateAssetCommand[]
  hints: ChallengeTemplateHintCommand[]
}

export class ChallengeTemplateService {
  constructor(private repository: ChallengeTemplateRepository) {}

  async create(actor: SessionSubject, input: VersionInput & {
    requestId: string
    name: string
    slug: string
  }): Promise<ChallengeTemplateDetail> {
    requireIdentityCapability(actor, identityCapability.contestManage)
    this.validatePolicies({
      flag_policy: input.flagPolicy,
      scoring_policy: input.scoringPolicy,
      instance_policy: input.instancePolicy,
    })
    return this.map(() => this.repository.create({
      actorId: actor.userId,
      requestId: input.requestId,
      templateId: randomUUID(),
      versionId: randomUUID(),
      name: input.name.trim(),
      slug: input.slug,
      ...this.snapshot(input),
    }))
  }

  async read(actor: SessionSubject, templateId: string, versionNumber?: number) {
    requireIdentityCapability(actor, identityCapability.contestManage)
    return this.map(() => this.repository.read(templateId, versionNumber))
  }

  async createVersion(actor: SessionSubject, input: {
    requestId: string
    templateId: string
    expectedVersion: number
    reason: string
    title?: string
    category?: ChallengeCategory
    description?: string
    flagFormat?: string | null
    flagPolicy?: ChallengeFlagPolicy
    scoringPolicy?: ChallengeScoringPolicy
    instancePolicy?: ChallengeInstancePolicy
    assets?: ChallengeTemplateAssetCommand[]
    hints?: ChallengeTemplateHintCommand[]
  }): Promise<ChallengeTemplateDetail> {
    requireIdentityCapability(actor, identityCapability.contestManage)
    const current = await this.map(() => this.repository.read(input.templateId))
    if (current.template.version !== input.expectedVersion) {
      throw new ChallengeTemplateServiceError('resource.version_conflict')
    }
    const next = this.snapshot({
      title: input.title ?? current.challengeVersion.title,
      category: input.category ?? current.challengeVersion.category,
      description: input.description ?? current.challengeVersion.description,
      flagFormat: input.flagFormat === undefined ? current.challengeVersion.flagFormat : input.flagFormat,
      flagPolicy: input.flagPolicy ?? current.challengeVersion.flagPolicy,
      scoringPolicy: input.scoringPolicy ?? current.challengeVersion.scoringPolicy,
      instancePolicy: input.instancePolicy ?? current.challengeVersion.instancePolicy,
      assets: input.assets ?? current.challengeVersion.assets.map(asset => ({
        contentObjectId: asset.contentObjectId,
        displayName: asset.displayName,
        sortOrder: asset.sortOrder,
      })),
      hints: input.hints ?? current.challengeVersion.hints.map(hint => ({
        title: hint.title,
        content: hint.content,
        releaseAfterSeconds: hint.releaseAfterSeconds,
        sortOrder: hint.sortOrder,
      })),
    })
    if (isDeepStrictEqual(this.snapshot(current.challengeVersion), next)) {
      throw new ChallengeTemplateServiceError('challenge.version_unchanged')
    }
    this.validatePolicies({
      flag_policy: next.flagPolicy,
      scoring_policy: next.scoringPolicy,
      instance_policy: next.instancePolicy,
    })
    return this.map(() => this.repository.createVersion({
      actorId: actor.userId,
      requestId: input.requestId,
      templateId: input.templateId,
      versionId: randomUUID(),
      expectedVersion: input.expectedVersion,
      reason: input.reason.trim(),
      ...next,
    }))
  }

  private snapshot(input: VersionInput): ChallengeVersionSnapshotCommand {
    return {
      title: input.title.trim(),
      category: input.category,
      description: input.description.trim(),
      flagFormat: input.flagFormat?.trim() || null,
      flagPolicy: input.flagPolicy,
      scoringPolicy: input.scoringPolicy,
      instancePolicy: input.instancePolicy,
      assets: input.assets.map(asset => ({
        contentObjectId: asset.contentObjectId,
        displayName: asset.displayName.trim(),
        sortOrder: asset.sortOrder,
      })),
      hints: input.hints.map(hint => ({
        title: hint.title.trim(),
        content: hint.content.trim(),
        releaseAfterSeconds: hint.releaseAfterSeconds,
        sortOrder: hint.sortOrder,
      })),
    }
  }

  private validatePolicies(input: Parameters<typeof assertChallengePolicies>[0]) {
    try {
      assertChallengePolicies(input)
    }
    catch (error) {
      if (error instanceof ChallengePolicyValidationError) {
        throw new ChallengeTemplateServiceError('challenge.policy_invalid', error.fields)
      }
      throw error
    }
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    }
    catch (error) {
      if (error instanceof ChallengeTemplateNotFoundError) {
        throw new ChallengeTemplateServiceError('challenge.template_not_found')
      }
      if (error instanceof ChallengeTemplateSlugConflictError) {
        throw new ChallengeTemplateServiceError('challenge.template_slug_conflict')
      }
      if (error instanceof ChallengeTemplateVersionConflictError) {
        throw new ChallengeTemplateServiceError('resource.version_conflict')
      }
      if (error instanceof ChallengeContentObjectUnavailableError) {
        throw new ChallengeTemplateServiceError('challenge.asset_unavailable', Object.fromEntries(
          error.contentObjectIds.map(id => [`assets.${id}`, ['内容对象不存在、未提交或已被隔离']]),
        ))
      }
      throw error
    }
  }
}
