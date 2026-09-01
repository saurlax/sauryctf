import { createHash } from 'node:crypto'
import type { ContestPackageExport, ContestPackageImport } from '../../../shared/contracts/contest-packages'
import { contestPackageFormat } from '../../../shared/contracts/contest-packages'
import { ContentObjectServiceError, type ContentObjectService } from '../content/service'
import {
  ContestPackageContestNotFoundError,
  ContestPackageExportNotFoundError,
  ContestPackageIdempotencyConflictError,
  type ContestPackageRepository,
} from './repository'
import {
  ContestPackageArchiveError,
  type ContestPackageArchive,
} from './archive'

export type ContestPackageServiceErrorCode =
  | 'package.archive_invalid'
  | 'package.compression_ratio_exceeded'
  | 'package.contest_not_found'
  | 'package.digest_mismatch'
  | 'package.entry_limit_exceeded'
  | 'package.export_not_found'
  | 'package.file_set_invalid'
  | 'package.idempotency_conflict'
  | 'package.invite_code_required'
  | 'package.manifest_invalid'
  | 'package.object_unavailable'
  | 'package.path_invalid'
  | 'package.size_limit_exceeded'

export class ContestPackageServiceError extends Error {
  constructor(readonly code: ContestPackageServiceErrorCode, message: string) {
    super(message)
    this.name = 'ContestPackageServiceError'
  }
}

export class ContestPackageService {
  constructor(
    private readonly repository: ContestPackageRepository,
    private readonly content: Pick<ContentObjectService,
      'createCommitted' | 'readCommitted'>,
    private readonly archive: ContestPackageArchive,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async exportContest(actorId: string, input: {
    requestId: string
    idempotencyKey: string
    contestId: string
    reason: string
  }): Promise<ContestPackageExport> {
    try {
      const snapshot = await this.repository.readSnapshot(input.contestId)
      const built = await this.archive.build(snapshot, this.now())
      const filename = `${safeFilename(snapshot.slug)}-${contestPackageFormat}.zip`
      const object = await this.content.createCommitted(actorId, {
        body: built.body,
        mediaType: 'application/zip',
        originalFilename: filename,
      })
      const record = await this.repository.recordExport({
        actorId,
        requestId: input.requestId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        contestId: input.contestId,
        packageObjectId: object.id,
      })
      return {
        id: record.id,
        contest_id: record.contestId,
        package_object_id: record.packageObjectId,
        package_version: record.packageVersion,
        filename,
        sha256: object.sha256Hex,
        size_bytes: object.sizeBytes,
        created_at: record.createdAt.toISOString(),
      }
    }
    catch (error) {
      throw serviceError(error)
    }
  }

  async downloadExport(exportId: string): Promise<{
    body: Uint8Array
    filename: string
    mediaType: 'application/zip'
  }> {
    try {
      const record = await this.repository.readExport(exportId)
      const content = await this.content.readCommitted(record.packageObjectId)
      return {
        body: content.body,
        filename: `${safeFilename(content.object.originalFilename.replace(/\.zip$/iu, ''))}.zip`,
        mediaType: 'application/zip',
      }
    }
    catch (error) {
      throw serviceError(error)
    }
  }

  async importContest(actorId: string, input: {
    requestId: string
    idempotencyKey: string
    packageObjectId: string
    inviteCode?: string
    reason: string
  }): Promise<ContestPackageImport> {
    try {
      const packageObject = await this.content.readCommitted(input.packageObjectId)
      const parsed = this.archive.parse(packageObject.body)
      if (parsed.manifest.contest.invite_required && !input.inviteCode) {
        throw new ContestPackageServiceError(
          'package.invite_code_required',
          '源比赛要求邀请码，导入时必须设置新的邀请码',
        )
      }
      const files = []
      for (const file of parsed.manifest.files) {
        const object = await this.content.createCommitted(actorId, {
          body: parsed.files.get(file.path)!,
          mediaType: file.media_type,
          originalFilename: file.filename,
        })
        files.push({ path: file.path, contentObjectId: object.id })
      }
      const record = await this.repository.importDraft({
        actorId,
        requestId: input.requestId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        packageObjectId: input.packageObjectId,
        inviteDigest: parsed.manifest.contest.invite_required && input.inviteCode
          ? createHash('sha256').update(input.inviteCode).digest()
          : null,
        manifest: parsed.manifest,
        files,
      })
      return {
        id: record.id,
        package_object_id: record.packageObjectId,
        package_version: record.packageVersion,
        contest_id: record.contestId,
        created_at: record.createdAt.toISOString(),
      }
    }
    catch (error) {
      throw serviceError(error)
    }
  }
}

function serviceError(error: unknown): Error {
  if (error instanceof ContestPackageServiceError) return error
  if (error instanceof ContestPackageArchiveError) {
    return new ContestPackageServiceError(error.code, error.message)
  }
  if (error instanceof ContestPackageContestNotFoundError) {
    return new ContestPackageServiceError('package.contest_not_found', '比赛不存在')
  }
  if (error instanceof ContestPackageExportNotFoundError) {
    return new ContestPackageServiceError('package.export_not_found', '比赛包导出不存在')
  }
  if (error instanceof ContestPackageIdempotencyConflictError) {
    return new ContestPackageServiceError('package.idempotency_conflict', '幂等键已用于其他比赛包操作')
  }
  if (error instanceof ContentObjectServiceError) {
    if (error.code === 'content.storage_mismatch' || error.code === 'content.digest_mismatch') {
      return new ContestPackageServiceError('package.digest_mismatch', '比赛包内容对象摘要校验失败')
    }
    if (error.code === 'content.upload_too_large') {
      return new ContestPackageServiceError('package.size_limit_exceeded', error.message)
    }
    return new ContestPackageServiceError('package.object_unavailable', '比赛包内容对象不存在或不可用')
  }
  return error instanceof Error ? error : new Error('Unknown contest package error')
}

function safeFilename(value: string) {
  const normalized = value.normalize('NFC').replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/gu, '')
  return normalized.slice(0, 120) || 'contest'
}
