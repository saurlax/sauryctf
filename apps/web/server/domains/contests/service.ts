import { identityCapability, requireIdentityCapability } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'
import {
  ContestNotEndedError,
  ContestNotFoundError,
  ContestSlugConflictError,
  ContestTransitionInvalidError,
  type ContestRecord,
  type ContestRepository,
} from './repository'

export type ContestServiceErrorCode =
  | 'contest.not_ended'
  | 'contest.not_found'
  | 'contest.slug_conflict'
  | 'contest.transition_invalid'

export class ContestServiceError extends Error {
  constructor(readonly code: ContestServiceErrorCode) {
    super({
      'contest.not_ended': '比赛尚未结束，不能归档',
      'contest.not_found': '比赛不存在或当前不可访问',
      'contest.slug_conflict': '比赛路径标识已被使用',
      'contest.transition_invalid': '当前比赛发布状态不允许此操作',
    }[code])
    this.name = 'ContestServiceError'
  }
}

export class ContestService {
  constructor(private repository: ContestRepository) {}

  async createDraft(actor: SessionSubject, input: {
    requestId: string
    title: string
    slug: string
    description: string
    startAt: Date
    endAt: Date
  }): Promise<ContestRecord> {
    requireIdentityCapability(actor, identityCapability.contestManage)
    return this.map(() => this.repository.createDraft({
      actorId: actor.userId,
      requestId: input.requestId,
      title: input.title.trim(),
      slug: input.slug,
      description: input.description,
      startAt: input.startAt,
      endAt: input.endAt,
    }))
  }

  async readManaged(actor: SessionSubject, contestId: string): Promise<ContestRecord> {
    requireIdentityCapability(actor, identityCapability.contestManage)
    return this.map(() => this.repository.readManaged(contestId))
  }

  async readPublic(contestId: string): Promise<ContestRecord> {
    return this.map(() => this.repository.readPublic(contestId))
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

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    }
    catch (error) {
      if (error instanceof ContestNotEndedError) throw new ContestServiceError('contest.not_ended')
      if (error instanceof ContestNotFoundError) throw new ContestServiceError('contest.not_found')
      if (error instanceof ContestSlugConflictError) throw new ContestServiceError('contest.slug_conflict')
      if (error instanceof ContestTransitionInvalidError) throw new ContestServiceError('contest.transition_invalid')
      throw error
    }
  }
}
