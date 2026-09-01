import type { H3Event } from 'h3'
import { getHeader, getQuery, setResponseHeader } from 'h3'
import {
  correctWriteupRequestSchema,
  managedWriteupListRequestSchema,
  managedWriteupListResponseSchema,
  ownWriteupResponseSchema,
  reviewWriteupRequestSchema,
  saveWriteupRequestSchema,
  writeupResponseSchema,
  type Writeup,
} from '../../../shared/contracts/writeups'
import { entityTagForVersion, requestIdSchema } from '../../../shared/contracts/http'
import { identityCapability } from '../../domains/identity/capabilities'
import type { WriteupRecord, WriteupVersionRecord } from '../../domains/writeups/repository'
import { WriteupServiceError, type WriteupService } from '../../domains/writeups/service'
import {
  identityHttpDependencies,
  requireProtectedCapability,
  type IdentityHttpDependencies,
} from '../auth/identity-http'
import { readValidatedJsonBody } from '../http/body'
import { createApiError } from '../http/errors'

type WriteupCommands = Pick<WriteupService,
  'correct' | 'exportSubmitted' | 'listManaged' | 'readOwn' | 'review' | 'saveOwn' | 'submitOwn'>

export interface WriteupHttpDependencies {
  identity: IdentityHttpDependencies
  writeups: WriteupCommands
}

export function writeupHttpDependencies(event: H3Event): WriteupHttpDependencies {
  if (!event.context.services) {
    throw createApiError(503, 'platform.not_ready', '控制面 Writeup 服务尚未就绪')
  }
  return {
    identity: identityHttpDependencies(event),
    writeups: event.context.services.writeups,
  }
}

export async function handleOwnWriteup(
  event: H3Event,
  contestId: string,
  dependencies = writeupHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.writeupWrite,
    dependencies.identity,
  )
  const state = await runWriteupOperation(() => dependencies.writeups.readOwn(context.subject, contestId))
  setResponseHeader(event, 'etag', state.writeup ? entityTagForVersion(state.writeup.version) : '"0"')
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return ownWriteupResponseSchema.parse({
    contest_id: state.contestId,
    writeup_required: state.writeupRequired,
    writeup_deadline_at: state.writeupDeadlineAt?.toISOString() ?? null,
    writeup: state.writeup ? projection(state.writeup) : null,
  })
}

export async function handleSaveOwnWriteup(
  event: H3Event,
  contestId: string,
  dependencies = writeupHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.writeupWrite,
    dependencies.identity,
  )
  const input = await readValidatedJsonBody(event, saveWriteupRequestSchema)
  const result = await runWriteupOperation(() => dependencies.writeups.saveOwn(context.subject, {
    contestId,
    expectedVersion: expectedVersion(event),
    body: input.body,
    attachmentIds: input.attachment_ids,
  }))
  return mutationResponse(event, result)
}

export async function handleSubmitOwnWriteup(
  event: H3Event,
  contestId: string,
  dependencies = writeupHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.writeupWrite,
    dependencies.identity,
  )
  const result = await runWriteupOperation(() => dependencies.writeups.submitOwn(context.subject, {
    contestId,
    expectedVersion: expectedVersion(event),
  }))
  return mutationResponse(event, result)
}

export async function handleListManagedWriteups(
  event: H3Event,
  contestId: string,
  dependencies = writeupHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contestJudge,
    dependencies.identity,
  )
  const input = managedWriteupListRequestSchema.parse(getQuery(event))
  const result = await runWriteupOperation(() => dependencies.writeups.listManaged(context.subject, {
    contestId,
    status: input.status,
    cursor: input.cursor,
    limit: input.limit,
  }))
  return managedWriteupListResponseSchema.parse({
    items: result.items.map(projection),
    page: { next_cursor: result.nextCursor, has_more: result.hasMore },
  })
}

export async function handleReviewWriteup(
  event: H3Event,
  contestId: string,
  writeupId: string,
  dependencies = writeupHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contestJudge,
    dependencies.identity,
  )
  const input = await readValidatedJsonBody(event, reviewWriteupRequestSchema)
  const result = await runWriteupOperation(() => dependencies.writeups.review(context.subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    contestId,
    writeupId,
    expectedVersion: expectedVersion(event),
    decision: input.decision,
    note: input.note,
  }))
  return mutationResponse(event, result)
}

export async function handleCorrectWriteup(
  event: H3Event,
  contestId: string,
  writeupId: string,
  dependencies = writeupHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contestJudge,
    dependencies.identity,
  )
  const input = await readValidatedJsonBody(event, correctWriteupRequestSchema)
  const result = await runWriteupOperation(() => dependencies.writeups.correct(context.subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    contestId,
    writeupId,
    expectedVersion: expectedVersion(event),
    body: input.body,
    attachmentIds: input.attachment_ids,
    reason: input.reason,
  }))
  return mutationResponse(event, result)
}

export async function handleExportSubmittedWriteups(
  event: H3Event,
  contestId: string,
  dependencies = writeupHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contestJudge,
    dependencies.identity,
  )
  const archive = await runWriteupOperation(() => dependencies.writeups.exportSubmitted(
    context.subject,
    contestId,
  ))
  setResponseHeader(event, 'cache-control', 'private, no-store')
  setResponseHeader(event, 'content-type', archive.mediaType)
  setResponseHeader(event, 'content-disposition', `attachment; filename="${archive.filename}"`)
  setResponseHeader(event, 'content-length', archive.body.byteLength)
  return Buffer.from(archive.body)
}

function expectedVersion(event: H3Event): number {
  const header = getHeader(event, 'if-match')
  const match = header ? /^"(0|[1-9]\d*)"$/u.exec(header) : null
  const version = match ? Number(match[1]) : Number.NaN
  if (!Number.isSafeInteger(version) || version < 0) {
    throw createApiError(428, 'resource.precondition_required', '需要有效的 If-Match 资源版本', {
      if_match: ['新建时使用 "0"，更新时使用当前资源的强 ETag，例如 "3"'],
    })
  }
  return version
}

function mutationResponse(event: H3Event, record: WriteupRecord) {
  setResponseHeader(event, 'etag', entityTagForVersion(record.version))
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return writeupResponseSchema.parse({ writeup: projection(record) })
}

function projection(record: WriteupRecord): Writeup {
  return {
    id: record.id,
    contest_id: record.contestId,
    participation_id: record.participationId,
    team_id: record.teamId,
    team_name: record.teamName,
    status: record.status,
    current_version: record.currentVersion,
    submitted_version: record.submittedVersion,
    submitted_at: record.submittedAt?.toISOString() ?? null,
    reviewed_by: record.reviewedBy,
    review_note: record.reviewNote,
    reviewed_at: record.reviewedAt?.toISOString() ?? null,
    version: record.version,
    updated_at: record.updatedAt.toISOString(),
    current: versionProjection(record.current),
    submitted: record.submitted ? versionProjection(record.submitted) : null,
  }
}

function versionProjection(version: WriteupVersionRecord) {
  return {
    id: version.id,
    version_number: version.versionNumber,
    body: version.body,
    created_by: version.createdBy,
    created_at: version.createdAt.toISOString(),
    attachments: version.attachments.map(attachment => ({
      reference_id: attachment.referenceId,
      content_object_id: attachment.contentObjectId,
      filename: attachment.filename,
      media_type: attachment.mediaType,
      size_bytes: attachment.sizeBytes,
      sha256: attachment.sha256Hex,
    })),
  }
}

async function runWriteupOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (!(error instanceof WriteupServiceError)) throw error
    if (error.code === 'writeup.input_invalid') {
      throw createApiError(400, 'validation.failed', error.message, error.fields)
    }
    const statusCode = {
      'writeup.not_found': 404,
      'writeup.contest_archived': 409,
      'writeup.not_required': 409,
      'writeup.deadline_passed': 409,
      'writeup.current_version_missing': 409,
      'writeup.not_submitted': 409,
      'writeup.no_changes_to_submit': 409,
      'writeup.attachment_unavailable': 409,
      'writeup.export_content_unavailable': 409,
      'resource.version_conflict': 409,
    }[error.code]
    throw createApiError(statusCode, error.code, error.message, error.fields)
  }
}
