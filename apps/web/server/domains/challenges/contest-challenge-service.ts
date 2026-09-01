import { randomUUID } from 'node:crypto'
import type {
  ChallengeCategory,
  ChallengeFlagPolicy,
  ChallengeInstancePolicy,
  ChallengeScoringPolicy,
} from '../../../shared/contracts/challenges'
import { identityCapability, requireIdentityCapability } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'
import { ChallengeContentObjectUnavailableError } from './repository'
import { assertChallengePolicies, ChallengePolicyValidationError } from './policies'
import {
  ContestChallengeArchivedError,
  ContestChallengeConfigurationLockedError,
  ContestChallengeNotFoundError,
  ContestChallengeRevisionNotAllowedError,
  ContestChallengeRevisionUnchangedError,
  ContestChallengeTemplateVersionNotFoundError,
  ContestChallengeTitleConflictError,
  ContestChallengeVersionConflictError,
  type ContestChallengeAssetCommand,
  type ContestChallengeHintCommand,
  type ContestChallengeRecord,
  type ContestChallengeRepository,
} from './contest-challenge-repository'

export type ContestChallengeServiceErrorCode =
  | 'challenge.asset_unavailable'
  | 'challenge.configuration_locked'
  | 'challenge.contest_archived'
  | 'challenge.not_found'
  | 'challenge.revision_not_allowed'
  | 'challenge.policy_invalid'
  | 'challenge.revision_reason_required'
  | 'challenge.revision_unchanged'
  | 'challenge.template_version_not_found'
  | 'challenge.title_conflict'
  | 'resource.version_conflict'

export class ContestChallengeServiceError extends Error {
  constructor(
    readonly code: ContestChallengeServiceErrorCode,
    readonly fields: Record<string, string[]> = {},
  ) {
    super({
      'challenge.asset_unavailable': '比赛题目附件尚未处于可引用状态',
      'challenge.configuration_locked': '只有草稿比赛可以挂载题目快照',
      'challenge.contest_archived': '归档比赛的题目快照不可修改',
      'challenge.not_found': '比赛或比赛题目不存在',
      'challenge.revision_not_allowed': '紧急修订只适用于已发布比赛',
      'challenge.policy_invalid': '比赛题目策略配置无效',
      'challenge.revision_reason_required': '紧急修订必须填写原因',
      'challenge.revision_unchanged': '比赛题目快照没有发生变化',
      'challenge.template_version_not_found': '指定的不可变题库版本不存在',
      'challenge.title_conflict': '比赛内已存在同名题目',
      'resource.version_conflict': '资源版本冲突，请刷新后重试',
    }[code])
    this.name = 'ContestChallengeServiceError'
  }
}

export class ContestChallengeService {
  constructor(private repository: ContestChallengeRepository) {}

  async mount(actor: SessionSubject, input: {
    requestId: string
    contestId: string
    templateVersionId: string
    enabled: boolean
    publishAt: Date | null
    closeAt: Date | null
    submissionLimit: number | null
    sortOrder: number
  }): Promise<ContestChallengeRecord> {
    requireIdentityCapability(actor, identityCapability.contestManage)
    return this.map(() => this.repository.mount({
      actorId: actor.userId,
      requestId: input.requestId,
      challengeId: randomUUID(),
      contestId: input.contestId,
      templateVersionId: input.templateVersionId,
      enabled: input.enabled,
      publishAt: input.publishAt,
      closeAt: input.closeAt,
      submissionLimit: input.submissionLimit,
      sortOrder: input.sortOrder,
    }))
  }

  async read(actor: SessionSubject, contestId: string, challengeId: string) {
    requireIdentityCapability(actor, identityCapability.contestManage)
    return this.map(() => this.repository.read(contestId, challengeId))
  }

  async revise(actor: SessionSubject, input: {
    requestId: string
    contestId: string
    challengeId: string
    expectedVersion: number
    reason: string
    title?: string
    category?: ChallengeCategory
    description?: string
    flagFormat?: string | null
    flagPolicy?: ChallengeFlagPolicy
    scoringPolicy?: ChallengeScoringPolicy
    instancePolicy?: ChallengeInstancePolicy
    assets?: ContestChallengeAssetCommand[]
    hints?: ContestChallengeHintCommand[]
    enabled?: boolean
    publishAt?: Date | null
    closeAt?: Date | null
    submissionLimit?: number | null
    sortOrder?: number
  }): Promise<ContestChallengeRecord> {
    requireIdentityCapability(actor, identityCapability.contestManage)
    if (!input.reason.trim()) {
      throw new ContestChallengeServiceError('challenge.revision_reason_required', {
        reason: ['紧急修订必须填写原因'],
      })
    }
    this.validatePolicies({
      flag_policy: input.flagPolicy,
      scoring_policy: input.scoringPolicy,
      instance_policy: input.instancePolicy,
    })
    return this.map(() => this.repository.revise({
      ...input,
      actorId: actor.userId,
      reason: input.reason.trim(),
      title: input.title?.trim(),
      description: input.description?.trim(),
      flagFormat: input.flagFormat === undefined ? undefined : input.flagFormat?.trim() || null,
      assets: input.assets?.map(asset => ({
        contentObjectId: asset.contentObjectId,
        displayName: asset.displayName.trim(),
        sortOrder: asset.sortOrder,
      })),
      hints: input.hints?.map(hint => ({
        title: hint.title.trim(),
        content: hint.content.trim(),
        releaseAt: hint.releaseAt,
        sortOrder: hint.sortOrder,
      })),
    }))
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    }
    catch (error) {
      if (error instanceof ContestChallengeNotFoundError) {
        throw new ContestChallengeServiceError('challenge.not_found')
      }
      if (error instanceof ContestChallengeTemplateVersionNotFoundError) {
        throw new ContestChallengeServiceError('challenge.template_version_not_found')
      }
      if (error instanceof ContestChallengeTitleConflictError) {
        throw new ContestChallengeServiceError('challenge.title_conflict')
      }
      if (error instanceof ContestChallengeConfigurationLockedError) {
        throw new ContestChallengeServiceError('challenge.configuration_locked')
      }
      if (error instanceof ContestChallengeRevisionNotAllowedError) {
        throw new ContestChallengeServiceError('challenge.revision_not_allowed')
      }
      if (error instanceof ContestChallengeArchivedError) {
        throw new ContestChallengeServiceError('challenge.contest_archived')
      }
      if (error instanceof ContestChallengeVersionConflictError) {
        throw new ContestChallengeServiceError('resource.version_conflict')
      }
      if (error instanceof ContestChallengeRevisionUnchangedError) {
        throw new ContestChallengeServiceError('challenge.revision_unchanged')
      }
      if (error instanceof ChallengeContentObjectUnavailableError) {
        throw new ContestChallengeServiceError('challenge.asset_unavailable', Object.fromEntries(
          error.contentObjectIds.map(id => [`assets.${id}`, ['内容对象不存在、未提交或已被隔离']]),
        ))
      }
      throw error
    }
  }

  private validatePolicies(input: Parameters<typeof assertChallengePolicies>[0]) {
    try {
      assertChallengePolicies(input)
    }
    catch (error) {
      if (error instanceof ChallengePolicyValidationError) {
        throw new ContestChallengeServiceError('challenge.policy_invalid', error.fields)
      }
      throw error
    }
  }
}
