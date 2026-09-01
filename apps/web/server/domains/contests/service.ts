import { createHash } from 'node:crypto'
import { identityCapability, requireIdentityCapability } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'
import {
  ContestConfigurationLockedError,
  ContestNotEndedError,
  ContestNotFoundError,
  ContestSlugConflictError,
  ContestTransitionInvalidError,
  ContestVersionConflictError,
  ContestPublicationCheckFailedError,
  type ContestRecord,
  type ContestRepository,
} from './repository'

export type ContestServiceErrorCode =
  | 'contest.configuration_invalid'
  | 'contest.configuration_locked'
  | 'contest.not_ended'
  | 'contest.not_found'
  | 'contest.slug_conflict'
  | 'contest.transition_invalid'
  | 'contest.publication_check_failed'
  | 'resource.version_conflict'

export class ContestServiceError extends Error {
  constructor(
    readonly code: ContestServiceErrorCode,
    readonly fields: Record<string, string[]> = {},
  ) {
    super({
      'contest.configuration_invalid': '比赛配置无效',
      'contest.configuration_locked': '只有草稿比赛可以修改常规配置',
      'contest.not_ended': '比赛尚未结束，不能归档',
      'contest.not_found': '比赛不存在或当前不可访问',
      'contest.slug_conflict': '比赛路径标识已被使用',
      'contest.transition_invalid': '当前比赛发布状态不允许此操作',
      'contest.publication_check_failed': '比赛未通过发布前完整性检查',
      'resource.version_conflict': '资源版本冲突，请刷新后重试',
    }[code])
    this.name = 'ContestServiceError'
  }
}

interface ContestConfiguration {
  visibility: 'public' | 'private'
  inviteRequired: boolean
  inviteConfigured: boolean
  registrationStrategy: 'review' | 'auto_accept'
  startAt: Date
  endAt: Date
  scoreboardFreezeAt: Date | null
  practiceEnabled: boolean
  writeupRequired: boolean
  writeupDeadlineAt: Date | null
  minTeamSize: number
  maxTeamSize: number
  allowedEmailDomains: string[]
}

interface CreateContestDraftInput {
  requestId: string
  title: string
  slug: string
  description: string
  visibility?: 'public' | 'private'
  inviteRequired?: boolean
  inviteCode?: string
  registrationStrategy?: 'review' | 'auto_accept'
  startAt: Date
  endAt: Date
  scoreboardFreezeAt?: Date | null
  practiceEnabled?: boolean
  writeupRequired?: boolean
  writeupDeadlineAt?: Date | null
  minTeamSize?: number
  maxTeamSize?: number
  allowedEmailDomains?: string[]
}

interface UpdateContestDraftInput {
  requestId: string
  contestId: string
  expectedVersion: number
  reason: string
  title?: string
  slug?: string
  description?: string
  visibility?: 'public' | 'private'
  inviteRequired?: boolean
  inviteCode?: string | null
  registrationStrategy?: 'review' | 'auto_accept'
  startAt?: Date
  endAt?: Date
  scoreboardFreezeAt?: Date | null
  practiceEnabled?: boolean
  writeupRequired?: boolean
  writeupDeadlineAt?: Date | null
  minTeamSize?: number
  maxTeamSize?: number
  allowedEmailDomains?: string[]
}

const inviteCodePattern = /^[A-Za-z0-9._:-]{32,128}$/u
const emailDomainPattern = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u

export class ContestService {
  constructor(private repository: ContestRepository) {}

  async createDraft(actor: SessionSubject, input: CreateContestDraftInput): Promise<ContestRecord> {
    requireIdentityCapability(actor, identityCapability.contestManage)
    const inviteCode = input.inviteCode?.trim()
    const configuration: ContestConfiguration = {
      visibility: input.visibility ?? 'public',
      inviteRequired: input.inviteRequired ?? false,
      inviteConfigured: Boolean(inviteCode),
      registrationStrategy: input.registrationStrategy ?? 'review',
      startAt: input.startAt,
      endAt: input.endAt,
      scoreboardFreezeAt: input.scoreboardFreezeAt ?? null,
      practiceEnabled: input.practiceEnabled ?? false,
      writeupRequired: input.writeupRequired ?? false,
      writeupDeadlineAt: input.writeupDeadlineAt ?? null,
      minTeamSize: input.minTeamSize ?? 1,
      maxTeamSize: input.maxTeamSize ?? 5,
      allowedEmailDomains: this.normalizeDomains(input.allowedEmailDomains ?? []),
    }
    this.validateConfiguration(configuration, inviteCode)

    return this.map(() => this.repository.createDraft({
      actorId: actor.userId,
      requestId: input.requestId,
      title: input.title.trim(),
      slug: input.slug,
      description: input.description,
      visibility: configuration.visibility,
      inviteRequired: configuration.inviteRequired,
      inviteDigest: inviteCode ? this.digestInvite(inviteCode) : null,
      registrationStrategy: configuration.registrationStrategy,
      startAt: configuration.startAt,
      endAt: configuration.endAt,
      scoreboardFreezeAt: configuration.scoreboardFreezeAt,
      practiceEnabled: configuration.practiceEnabled,
      writeupRequired: configuration.writeupRequired,
      writeupDeadlineAt: configuration.writeupDeadlineAt,
      minTeamSize: configuration.minTeamSize,
      maxTeamSize: configuration.maxTeamSize,
      registrationConstraints: { allowedEmailDomains: configuration.allowedEmailDomains },
    }))
  }

  async updateDraft(actor: SessionSubject, input: UpdateContestDraftInput): Promise<ContestRecord> {
    requireIdentityCapability(actor, identityCapability.contestManage)
    const current = await this.map(() => this.repository.readManaged(input.contestId))
    if (current.version !== input.expectedVersion) {
      throw new ContestServiceError('resource.version_conflict')
    }

    const inviteCode = input.inviteCode?.trim()
    const inviteConfigured = input.inviteCode === undefined
      ? current.inviteConfigured
      : input.inviteCode !== null && Boolean(inviteCode)
    const configuration: ContestConfiguration = {
      visibility: input.visibility ?? current.visibility,
      inviteRequired: input.inviteRequired ?? current.inviteRequired,
      inviteConfigured,
      registrationStrategy: input.registrationStrategy ?? current.registrationStrategy,
      startAt: input.startAt ?? current.startAt,
      endAt: input.endAt ?? current.endAt,
      scoreboardFreezeAt: input.scoreboardFreezeAt === undefined
        ? current.scoreboardFreezeAt
        : input.scoreboardFreezeAt,
      practiceEnabled: input.practiceEnabled ?? current.practiceEnabled,
      writeupRequired: input.writeupRequired ?? current.writeupRequired,
      writeupDeadlineAt: input.writeupDeadlineAt === undefined
        ? current.writeupDeadlineAt
        : input.writeupDeadlineAt,
      minTeamSize: input.minTeamSize ?? current.minTeamSize,
      maxTeamSize: input.maxTeamSize ?? current.maxTeamSize,
      allowedEmailDomains: input.allowedEmailDomains === undefined
        ? current.registrationConstraints.allowedEmailDomains
        : this.normalizeDomains(input.allowedEmailDomains),
    }
    this.validateConfiguration(configuration, inviteCode, input.inviteCode !== undefined)

    return this.map(() => this.repository.updateDraft({
      actorId: actor.userId,
      requestId: input.requestId,
      contestId: input.contestId,
      expectedVersion: input.expectedVersion,
      reason: input.reason.trim(),
      title: input.title?.trim() ?? current.title,
      slug: input.slug ?? current.slug,
      description: input.description ?? current.description,
      visibility: configuration.visibility,
      inviteRequired: configuration.inviteRequired,
      replaceInviteDigest: input.inviteCode !== undefined,
      inviteDigest: inviteCode ? this.digestInvite(inviteCode) : null,
      registrationStrategy: configuration.registrationStrategy,
      startAt: configuration.startAt,
      endAt: configuration.endAt,
      scoreboardFreezeAt: configuration.scoreboardFreezeAt,
      practiceEnabled: configuration.practiceEnabled,
      writeupRequired: configuration.writeupRequired,
      writeupDeadlineAt: configuration.writeupDeadlineAt,
      minTeamSize: configuration.minTeamSize,
      maxTeamSize: configuration.maxTeamSize,
      registrationConstraints: { allowedEmailDomains: configuration.allowedEmailDomains },
    }))
  }

  async readManaged(actor: SessionSubject, contestId: string): Promise<ContestRecord> {
    requireIdentityCapability(actor, identityCapability.contestManage)
    return this.map(() => this.repository.readManaged(contestId))
  }

  async readPublic(contestId: string): Promise<ContestRecord> {
    return this.map(() => this.repository.readPublic(contestId))
  }

  async checkPublication(actor: SessionSubject, contestId: string) {
    requireIdentityCapability(actor, identityCapability.contestManage)
    return this.map(() => this.repository.checkPublication(contestId))
  }

  async publish(actor: SessionSubject, input: {
    requestId: string
    contestId: string
    reason: string
  }): Promise<ContestRecord> {
    requireIdentityCapability(actor, identityCapability.contestManage)
    return this.map(() => this.repository.publish({
      actorId: actor.userId,
      requestId: input.requestId,
      contestId: input.contestId,
      reason: input.reason.trim(),
    }))
  }

  async archive(actor: SessionSubject, input: {
    requestId: string
    contestId: string
    reason: string
  }): Promise<ContestRecord> {
    requireIdentityCapability(actor, identityCapability.contestManage)
    return this.map(() => this.repository.archive({
      actorId: actor.userId,
      requestId: input.requestId,
      contestId: input.contestId,
      reason: input.reason.trim(),
    }))
  }

  private validateConfiguration(
    configuration: ContestConfiguration,
    inviteCode?: string,
    replacingInvite = true,
  ) {
    const fields: Record<string, string[]> = {}
    const issue = (field: string, message: string) => {
      fields[field] ??= []
      fields[field].push(message)
    }

    const startAt = configuration.startAt.getTime()
    const endAt = configuration.endAt.getTime()
    if (!Number.isFinite(startAt)) issue('start_at', '开始时间无效')
    if (!Number.isFinite(endAt) || endAt <= startAt) issue('end_at', '结束时间必须晚于开始时间')
    if (configuration.scoreboardFreezeAt) {
      const freezeAt = configuration.scoreboardFreezeAt.getTime()
      if (!Number.isFinite(freezeAt) || freezeAt < startAt || freezeAt > endAt) {
        issue('scoreboard_freeze_at', '封榜时间必须位于比赛时间窗口内')
      }
    }
    if (configuration.writeupDeadlineAt) {
      if (!configuration.writeupRequired) {
        issue('writeup_deadline_at', '未要求 Writeup 时不能设置截止时间')
      }
      else if (!Number.isFinite(configuration.writeupDeadlineAt.getTime())
        || configuration.writeupDeadlineAt.getTime() < endAt) {
        issue('writeup_deadline_at', 'Writeup 截止时间不得早于比赛结束时间')
      }
    }
    if (!Number.isInteger(configuration.minTeamSize)
      || configuration.minTeamSize < 1
      || configuration.minTeamSize > 100) {
      issue('min_team_size', '队伍人数下限必须是 1 到 100 的整数')
    }
    if (!Number.isInteger(configuration.maxTeamSize)
      || configuration.maxTeamSize < 1
      || configuration.maxTeamSize > 100
      || configuration.maxTeamSize < configuration.minTeamSize) {
      issue('max_team_size', '队伍人数上限必须是 1 到 100 的整数且不得小于下限')
    }
    if (!['public', 'private'].includes(configuration.visibility)) {
      issue('visibility', '比赛可见性无效')
    }
    if (!['review', 'auto_accept'].includes(configuration.registrationStrategy)) {
      issue('registration_strategy', '报名策略无效')
    }
    if (configuration.inviteRequired && !configuration.inviteConfigured) {
      issue('invite_code', '启用邀请码要求时必须设置邀请码')
    }
    if (replacingInvite && inviteCode !== undefined && !inviteCodePattern.test(inviteCode)) {
      issue('invite_code', '邀请码必须为 32 到 128 位安全字符')
    }
    for (const [index, domain] of configuration.allowedEmailDomains.entries()) {
      if (!emailDomainPattern.test(domain)) {
        issue(`registration_constraints.allowed_email_domains.${index}`, '邮箱域名无效')
      }
    }

    if (Object.keys(fields).length) {
      throw new ContestServiceError('contest.configuration_invalid', fields)
    }
  }

  private normalizeDomains(domains: string[]) {
    return [...new Set(domains.map(domain => domain.trim().toLowerCase()))]
  }

  private digestInvite(inviteCode: string) {
    return createHash('sha256').update(inviteCode).digest()
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    }
    catch (error) {
      if (error instanceof ContestConfigurationLockedError) throw new ContestServiceError('contest.configuration_locked')
      if (error instanceof ContestNotEndedError) throw new ContestServiceError('contest.not_ended')
      if (error instanceof ContestNotFoundError) throw new ContestServiceError('contest.not_found')
      if (error instanceof ContestSlugConflictError) throw new ContestServiceError('contest.slug_conflict')
      if (error instanceof ContestTransitionInvalidError) throw new ContestServiceError('contest.transition_invalid')
      if (error instanceof ContestVersionConflictError) throw new ContestServiceError('resource.version_conflict')
      if (error instanceof ContestPublicationCheckFailedError) {
        const fields: Record<string, string[]> = {}
        for (const issue of error.check.issues) {
          (fields[issue.field] ??= []).push(issue.message)
        }
        throw new ContestServiceError('contest.publication_check_failed', fields)
      }
      throw error
    }
  }
}
