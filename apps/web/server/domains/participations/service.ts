import { createHash } from 'node:crypto'
import { identityCapability, requireIdentityCapability } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'
import {
  ParticipationConfigurationInvalidError,
  ParticipationConflictError,
  ParticipationContestNotFoundError,
  ParticipationDivisionInvalidError,
  ParticipationEmailDomainForbiddenError,
  ParticipationInviteInvalidError,
  ParticipationMemberIneligibleError,
  ParticipationNotFoundError,
  ParticipationRegistrationClosedError,
  ParticipationTeamRequiredError,
  ParticipationTeamSizeError,
  ParticipationTransitionInvalidError,
  type ParticipationPage,
  type ParticipationRecord,
  type ParticipationRepository,
  type ParticipationStatus,
} from './repository'

export type ParticipationServiceErrorCode =
  | 'participation.configuration_invalid'
  | 'participation.conflict'
  | 'participation.contest_not_found'
  | 'participation.division_invalid'
  | 'participation.email_domain_forbidden'
  | 'participation.invite_invalid'
  | 'participation.member_ineligible'
  | 'participation.not_found'
  | 'participation.registration_closed'
  | 'participation.team_required'
  | 'participation.team_size_invalid'
  | 'participation.transition_invalid'

export class ParticipationServiceError extends Error {
  constructor(
    readonly code: ParticipationServiceErrorCode,
    readonly fields: Record<string, string[]> = {},
  ) {
    super({
      'participation.configuration_invalid': '比赛报名条件配置无效',
      'participation.conflict': '当前队伍已有不能重复提交的报名记录',
      'participation.contest_not_found': '比赛不存在或当前不可访问',
      'participation.division_invalid': '分组不存在或不属于当前比赛',
      'participation.email_domain_forbidden': '队伍成员邮箱不满足比赛要求',
      'participation.invite_invalid': '比赛邀请码无效',
      'participation.member_ineligible': '队伍中存在未验证邮箱、受限或未完成安全设置的成员',
      'participation.not_found': '报名记录不存在',
      'participation.registration_closed': '当前比赛不接受新的报名或通过操作',
      'participation.team_required': '当前账号尚未加入队伍',
      'participation.team_size_invalid': '队伍人数不满足比赛要求',
      'participation.transition_invalid': '当前报名状态不允许此操作',
    }[code])
    this.name = 'ParticipationServiceError'
  }
}

export class ParticipationService {
  constructor(private repository: ParticipationRepository) {}

  async current(actor: SessionSubject, contestId: string) {
    requireIdentityCapability(actor, identityCapability.publicBrowse)
    return this.map(() => this.repository.current(actor.userId, contestId))
  }

  async register(actor: SessionSubject, contestId: string, inviteCode?: string): Promise<ParticipationRecord> {
    requireIdentityCapability(actor, identityCapability.contestRegister)
    const inviteDigest = inviteCode ? createHash('sha256').update(inviteCode).digest() : null
    return this.map(() => this.repository.register(actor.userId, contestId, inviteDigest))
  }

  async withdraw(actor: SessionSubject, contestId: string): Promise<ParticipationRecord> {
    requireIdentityCapability(actor, identityCapability.contestRegister)
    return this.map(() => this.repository.withdraw(actor.userId, contestId))
  }

  async review(actor: SessionSubject, input: {
    requestId: string
    contestId: string
    participationId: string
    decision: 'accepted' | 'rejected'
    reason: string
  }): Promise<ParticipationRecord> {
    requireIdentityCapability(actor, identityCapability.contestJudge)
    return this.map(() => this.repository.review({
      actorId: actor.userId,
      requestId: input.requestId,
      contestId: input.contestId,
      participationId: input.participationId,
      decision: input.decision,
      reason: input.reason.trim(),
    }))
  }

  async assignDivision(actor: SessionSubject, input: {
    requestId: string
    contestId: string
    participationId: string
    divisionId: string | null
    reason?: string
  }): Promise<ParticipationRecord> {
    requireIdentityCapability(actor, identityCapability.contestJudge)
    return this.map(() => this.repository.assignDivision({
      actorId: actor.userId,
      requestId: input.requestId,
      contestId: input.contestId,
      participationId: input.participationId,
      divisionId: input.divisionId,
      reason: input.reason?.trim() || null,
    }))
  }

  async list(
    actor: SessionSubject,
    contestId: string,
    cursor: string | undefined,
    limit: number,
    status: ParticipationStatus | undefined,
  ): Promise<ParticipationPage> {
    requireIdentityCapability(actor, identityCapability.contestJudge)
    return this.map(() => this.repository.list(contestId, cursor, limit, status))
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    }
    catch (error) {
      if (error instanceof ParticipationConfigurationInvalidError) throw new ParticipationServiceError('participation.configuration_invalid')
      if (error instanceof ParticipationConflictError) throw new ParticipationServiceError('participation.conflict')
      if (error instanceof ParticipationContestNotFoundError) throw new ParticipationServiceError('participation.contest_not_found')
      if (error instanceof ParticipationDivisionInvalidError) throw new ParticipationServiceError('participation.division_invalid')
      if (error instanceof ParticipationEmailDomainForbiddenError) throw new ParticipationServiceError('participation.email_domain_forbidden')
      if (error instanceof ParticipationInviteInvalidError) throw new ParticipationServiceError('participation.invite_invalid')
      if (error instanceof ParticipationMemberIneligibleError) throw new ParticipationServiceError('participation.member_ineligible')
      if (error instanceof ParticipationNotFoundError) throw new ParticipationServiceError('participation.not_found')
      if (error instanceof ParticipationRegistrationClosedError) throw new ParticipationServiceError('participation.registration_closed')
      if (error instanceof ParticipationTeamRequiredError) throw new ParticipationServiceError('participation.team_required')
      if (error instanceof ParticipationTeamSizeError) {
        throw new ParticipationServiceError('participation.team_size_invalid', {
          team_size: [`实际 ${error.actual} 人，要求 ${error.minimum}–${error.maximum} 人`],
        })
      }
      if (error instanceof ParticipationTransitionInvalidError) throw new ParticipationServiceError('participation.transition_invalid')
      throw error
    }
  }
}
