import { identityCapability, requireIdentityCapability } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'
import {
  WriteupAttachmentUnavailableError,
  WriteupContestArchivedError,
  WriteupCurrentVersionMissingError,
  WriteupDeadlinePassedError,
  WriteupNoChangesToSubmitError,
  WriteupNotFoundError,
  WriteupNotRequiredError,
  WriteupNotSubmittedError,
  WriteupVersionConflictError,
  type ManagedWriteupPage,
  type OwnWriteupState,
  type WriteupExportSnapshot,
  type WriteupRecord,
  type WriteupRepository,
  type WriteupReviewDecision,
  type WriteupStatus,
} from './repository'

export interface WriteupArchive {
  body: Uint8Array
  filename: string
  mediaType: 'application/zip'
}

export interface WriteupArchiveBuilder {
  build(snapshot: WriteupExportSnapshot, exportedAt: Date): Promise<Uint8Array>
}

export class WriteupArchiveContentUnavailableError extends Error {}

export type WriteupServiceErrorCode =
  | 'writeup.not_found'
  | 'writeup.contest_archived'
  | 'writeup.not_required'
  | 'writeup.deadline_passed'
  | 'writeup.current_version_missing'
  | 'writeup.not_submitted'
  | 'writeup.no_changes_to_submit'
  | 'writeup.attachment_unavailable'
  | 'writeup.export_content_unavailable'
  | 'writeup.input_invalid'
  | 'resource.version_conflict'

export class WriteupServiceError extends Error {
  constructor(
    readonly code: WriteupServiceErrorCode,
    readonly fields: Record<string, string[]> = {},
  ) {
    super({
      'writeup.not_found': 'Writeup 不存在或当前账号无权访问',
      'writeup.contest_archived': '归档比赛的 Writeup 不可修改或审核',
      'writeup.not_required': '该比赛未要求提交 Writeup',
      'writeup.deadline_passed': 'Writeup 截止时间已过',
      'writeup.current_version_missing': '请先保存一个 Writeup 版本',
      'writeup.not_submitted': 'Writeup 尚未提交，不能审核',
      'writeup.no_changes_to_submit': '当前版本已经提交，没有新的内容可提交',
      'writeup.attachment_unavailable': '一个或多个附件不存在、未提交或已被隔离',
      'writeup.export_content_unavailable': '导出所需的附件当前不可用',
      'writeup.input_invalid': 'Writeup 输入无效',
      'resource.version_conflict': '资源版本冲突，请刷新后重试',
    }[code])
    this.name = 'WriteupServiceError'
  }
}

export class WriteupService {
  constructor(
    private readonly repository: WriteupRepository,
    private readonly archiveBuilder: WriteupArchiveBuilder,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async readOwn(actor: SessionSubject, contestId: string): Promise<OwnWriteupState> {
    requireIdentityCapability(actor, identityCapability.writeupWrite)
    return this.map(() => this.repository.readOwn(actor.userId, contestId))
  }

  async saveOwn(actor: SessionSubject, input: {
    contestId: string
    expectedVersion: number
    body: string
    attachmentIds: string[]
  }): Promise<WriteupRecord> {
    requireIdentityCapability(actor, identityCapability.writeupWrite)
    const content = validateVersionInput(input.body, input.attachmentIds)
    return this.map(() => this.repository.saveOwn({
      actorId: actor.userId,
      contestId: input.contestId,
      expectedVersion: input.expectedVersion,
      ...content,
    }))
  }

  async submitOwn(actor: SessionSubject, input: {
    contestId: string
    expectedVersion: number
  }): Promise<WriteupRecord> {
    requireIdentityCapability(actor, identityCapability.writeupWrite)
    return this.map(() => this.repository.submitOwn({
      actorId: actor.userId,
      contestId: input.contestId,
      expectedVersion: input.expectedVersion,
    }))
  }

  async listManaged(actor: SessionSubject, input: {
    contestId: string
    status?: WriteupStatus
    cursor?: string
    limit: number
  }): Promise<ManagedWriteupPage> {
    requireIdentityCapability(actor, identityCapability.contestJudge)
    return this.map(() => this.repository.listManaged(
      input.contestId,
      input.status,
      input.cursor,
      input.limit,
    ))
  }

  async review(actor: SessionSubject, input: {
    requestId: string
    contestId: string
    writeupId: string
    expectedVersion: number
    decision: WriteupReviewDecision
    note: string | null
  }): Promise<WriteupRecord> {
    requireIdentityCapability(actor, identityCapability.contestJudge)
    const note = input.note?.trim() || null
    if (input.decision === 'changes_requested' && !note) {
      throw new WriteupServiceError('writeup.input_invalid', {
        note: ['要求修改时必须填写审核备注'],
      })
    }
    return this.map(() => this.repository.review({
      ...input,
      actorId: actor.userId,
      note,
    }))
  }

  async correct(actor: SessionSubject, input: {
    requestId: string
    contestId: string
    writeupId: string
    expectedVersion: number
    body: string
    attachmentIds: string[]
    reason: string
  }): Promise<WriteupRecord> {
    requireIdentityCapability(actor, identityCapability.contestJudge)
    const content = validateVersionInput(input.body, input.attachmentIds)
    const reason = input.reason.trim()
    if (reason.length < 3 || reason.length > 1000) {
      throw new WriteupServiceError('writeup.input_invalid', {
        reason: ['原因长度必须在 3 到 1000 个字符之间'],
      })
    }
    return this.map(() => this.repository.correct({
      actorId: actor.userId,
      requestId: input.requestId,
      contestId: input.contestId,
      writeupId: input.writeupId,
      expectedVersion: input.expectedVersion,
      reason,
      ...content,
    }))
  }

  async exportSubmitted(actor: SessionSubject, contestId: string): Promise<WriteupArchive> {
    requireIdentityCapability(actor, identityCapability.contestJudge)
    const snapshot = await this.map(() => this.repository.exportSubmitted(contestId))
    try {
      return {
        body: await this.archiveBuilder.build(snapshot, this.now()),
        filename: `writeups-${snapshot.contestId}.zip`,
        mediaType: 'application/zip',
      }
    }
    catch (error) {
      if (error instanceof WriteupArchiveContentUnavailableError) {
        throw new WriteupServiceError('writeup.export_content_unavailable')
      }
      throw error
    }
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    }
    catch (error) {
      if (error instanceof WriteupNotFoundError) {
        throw new WriteupServiceError('writeup.not_found')
      }
      if (error instanceof WriteupContestArchivedError) {
        throw new WriteupServiceError('writeup.contest_archived')
      }
      if (error instanceof WriteupNotRequiredError) {
        throw new WriteupServiceError('writeup.not_required')
      }
      if (error instanceof WriteupDeadlinePassedError) {
        throw new WriteupServiceError('writeup.deadline_passed')
      }
      if (error instanceof WriteupVersionConflictError) {
        throw new WriteupServiceError('resource.version_conflict')
      }
      if (error instanceof WriteupCurrentVersionMissingError) {
        throw new WriteupServiceError('writeup.current_version_missing')
      }
      if (error instanceof WriteupNotSubmittedError) {
        throw new WriteupServiceError('writeup.not_submitted')
      }
      if (error instanceof WriteupNoChangesToSubmitError) {
        throw new WriteupServiceError('writeup.no_changes_to_submit')
      }
      if (error instanceof WriteupAttachmentUnavailableError) {
        throw new WriteupServiceError('writeup.attachment_unavailable', Object.fromEntries(
          error.contentObjectIds.map(id => [`attachment_ids.${id}`, ['内容对象不可用']]),
        ))
      }
      throw error
    }
  }
}

function validateVersionInput(body: string, attachmentIds: string[]) {
  const normalizedBody = body.trim()
  const uniqueAttachmentIds = [...new Set(attachmentIds)]
  const fields: Record<string, string[]> = {}
  if (normalizedBody.length === 0 || normalizedBody.length > 1_000_000) {
    fields.body = ['正文长度必须在 1 到 1000000 个字符之间']
  }
  if (uniqueAttachmentIds.length !== attachmentIds.length) {
    fields.attachment_ids = ['附件不能重复']
  }
  if (attachmentIds.length > 50) {
    fields.attachment_ids = ['每个版本最多包含 50 个附件']
  }
  if (Object.keys(fields).length > 0) {
    throw new WriteupServiceError('writeup.input_invalid', fields)
  }
  return { body: normalizedBody, attachmentIds: uniqueAttachmentIds }
}
