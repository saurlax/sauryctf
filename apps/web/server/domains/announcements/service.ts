import { randomUUID } from 'node:crypto'
import { identityCapability, requireIdentityCapability } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'
import {
  AnnouncementContestArchivedError,
  AnnouncementContestNotFoundError,
  AnnouncementNotFoundError,
  AnnouncementVersionConflictError,
  AnnouncementWithdrawnError,
  type AnnouncementPage,
  type AnnouncementRecord,
  type AnnouncementRepository,
} from './repository'

export type AnnouncementServiceErrorCode =
  | 'announcement.contest_archived'
  | 'announcement.contest_not_found'
  | 'announcement.not_found'
  | 'announcement.withdrawn'
  | 'resource.version_conflict'

export class AnnouncementServiceError extends Error {
  constructor(readonly code: AnnouncementServiceErrorCode) {
    super({
      'announcement.contest_archived': '归档比赛的公告不可修改',
      'announcement.contest_not_found': '比赛不存在或当前不可访问',
      'announcement.not_found': '公告不存在或当前不可访问',
      'announcement.withdrawn': '公告已经撤回',
      'resource.version_conflict': '资源版本冲突，请刷新后重试',
    }[code])
    this.name = 'AnnouncementServiceError'
  }
}

export class AnnouncementService {
  constructor(private repository: AnnouncementRepository) {}

  async create(actor: SessionSubject, input: {
    requestId: string
    contestId: string
    title: string
    body: string
    publishAt: Date
  }): Promise<AnnouncementRecord> {
    requireIdentityCapability(actor, identityCapability.contestManage)
    return this.map(() => this.repository.create({
      announcementId: randomUUID(),
      actorId: actor.userId,
      requestId: input.requestId,
      contestId: input.contestId,
      title: input.title.trim(),
      body: input.body.trim(),
      publishAt: input.publishAt,
    }))
  }

  async readManaged(actor: SessionSubject, contestId: string, announcementId: string) {
    requireIdentityCapability(actor, identityCapability.contestManage)
    return this.map(() => this.repository.readManaged(contestId, announcementId))
  }

  async listManaged(
    actor: SessionSubject,
    contestId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<AnnouncementPage> {
    requireIdentityCapability(actor, identityCapability.contestManage)
    return this.map(() => this.repository.listManaged(contestId, cursor, limit))
  }

  async listPublic(
    contestId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<AnnouncementPage> {
    return this.map(() => this.repository.listPublic(contestId, cursor, limit))
  }

  async update(actor: SessionSubject, input: {
    requestId: string
    contestId: string
    announcementId: string
    expectedVersion: number
    reason: string
    title?: string
    body?: string
    publishAt?: Date
  }): Promise<AnnouncementRecord> {
    requireIdentityCapability(actor, identityCapability.contestManage)
    const current = await this.map(() => this.repository.readManaged(input.contestId, input.announcementId))
    if (current.version !== input.expectedVersion) {
      throw new AnnouncementServiceError('resource.version_conflict')
    }
    return this.map(() => this.repository.update({
      actorId: actor.userId,
      requestId: input.requestId,
      contestId: input.contestId,
      announcementId: input.announcementId,
      expectedVersion: input.expectedVersion,
      reason: input.reason.trim(),
      title: input.title?.trim() ?? current.title,
      body: input.body?.trim() ?? current.body,
      publishAt: input.publishAt ?? current.publishAt,
    }))
  }

  async withdraw(actor: SessionSubject, input: {
    requestId: string
    contestId: string
    announcementId: string
    expectedVersion: number
    reason: string
  }): Promise<AnnouncementRecord> {
    requireIdentityCapability(actor, identityCapability.contestManage)
    return this.map(() => this.repository.withdraw({
      actorId: actor.userId,
      requestId: input.requestId,
      contestId: input.contestId,
      announcementId: input.announcementId,
      expectedVersion: input.expectedVersion,
      reason: input.reason.trim(),
    }))
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    }
    catch (error) {
      if (error instanceof AnnouncementContestArchivedError) {
        throw new AnnouncementServiceError('announcement.contest_archived')
      }
      if (error instanceof AnnouncementContestNotFoundError) {
        throw new AnnouncementServiceError('announcement.contest_not_found')
      }
      if (error instanceof AnnouncementNotFoundError) {
        throw new AnnouncementServiceError('announcement.not_found')
      }
      if (error instanceof AnnouncementWithdrawnError) {
        throw new AnnouncementServiceError('announcement.withdrawn')
      }
      if (error instanceof AnnouncementVersionConflictError) {
        throw new AnnouncementServiceError('resource.version_conflict')
      }
      throw error
    }
  }
}
