import type { H3Event } from 'h3'
import { getHeader, getQuery, setResponseHeader, setResponseStatus } from 'h3'
import {
  announcementListRequestSchema,
  announcementListResponseSchema,
  announcementResponseSchema,
  createAnnouncementRequestSchema,
  updateAnnouncementRequestSchema,
  withdrawAnnouncementRequestSchema,
  type Announcement,
} from '../../../shared/contracts/announcements'
import {
  entityTagForVersion,
  requestIdSchema,
  versionFromIfMatch,
} from '../../../shared/contracts/http'
import { identityCapability } from '../../domains/identity/capabilities'
import type { AnnouncementRecord } from '../../domains/announcements/repository'
import {
  AnnouncementServiceError,
  type AnnouncementService,
} from '../../domains/announcements/service'
import {
  identityHttpDependencies,
  requireProtectedCapability,
  type IdentityHttpDependencies,
} from '../auth/identity-http'
import { readValidatedJsonBody } from '../http/body'
import { createApiError } from '../http/errors'

type AnnouncementCommands = Pick<AnnouncementService,
  'create' | 'listManaged' | 'listPublic' | 'update' | 'withdraw'>

export interface AnnouncementHttpDependencies {
  identity: IdentityHttpDependencies
  announcements: AnnouncementCommands
}

export function announcementHttpDependencies(event: H3Event): AnnouncementHttpDependencies {
  if (!event.context.services) {
    throw createApiError(503, 'platform.not_ready', '控制面数据库服务尚未就绪')
  }
  return {
    identity: identityHttpDependencies(event),
    announcements: event.context.services.announcements,
  }
}

function projection(record: AnnouncementRecord): Announcement {
  return {
    id: record.id,
    contest_id: record.contestId,
    title: record.title,
    body: record.body,
    status: record.status,
    publish_at: record.publishAt.toISOString(),
    withdrawn_at: record.withdrawnAt?.toISOString() ?? null,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
    version: record.version,
  }
}

async function manager(event: H3Event, dependencies: AnnouncementHttpDependencies) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contestManage,
    dependencies.identity,
  )
  return context.subject
}

async function runAnnouncementOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (!(error instanceof AnnouncementServiceError)) throw error
    const statusCode = {
      'announcement.contest_archived': 409,
      'announcement.contest_not_found': 404,
      'announcement.not_found': 404,
      'announcement.withdrawn': 409,
      'resource.version_conflict': 409,
    }[error.code]
    throw createApiError(statusCode, error.code, error.message)
  }
}

function expectedVersion(event: H3Event) {
  const version = versionFromIfMatch(getHeader(event, 'if-match'))
  if (version === null) {
    throw createApiError(428, 'resource.precondition_required', '需要有效的 If-Match 资源版本', {
      if_match: ['请提交当前资源的强 ETag，例如 "3"'],
    })
  }
  return version
}

function mutationResponse(event: H3Event, record: AnnouncementRecord) {
  setResponseHeader(event, 'etag', entityTagForVersion(record.version))
  return announcementResponseSchema.parse({ announcement: projection(record) })
}

export async function handleCreateAnnouncement(
  event: H3Event,
  contestId: string,
  dependencies = announcementHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  const input = await readValidatedJsonBody(event, createAnnouncementRequestSchema)
  const result = await runAnnouncementOperation(() => dependencies.announcements.create(subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    contestId,
    title: input.title,
    body: input.body,
    publishAt: new Date(input.publish_at),
  }))
  setResponseStatus(event, 201)
  return mutationResponse(event, result)
}

export async function handleUpdateAnnouncement(
  event: H3Event,
  contestId: string,
  announcementId: string,
  dependencies = announcementHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  const version = expectedVersion(event)
  const input = await readValidatedJsonBody(event, updateAnnouncementRequestSchema)
  const result = await runAnnouncementOperation(() => dependencies.announcements.update(subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    contestId,
    announcementId,
    expectedVersion: version,
    reason: input.reason,
    title: input.title,
    body: input.body,
    publishAt: input.publish_at ? new Date(input.publish_at) : undefined,
  }))
  return mutationResponse(event, result)
}

export async function handleWithdrawAnnouncement(
  event: H3Event,
  contestId: string,
  announcementId: string,
  dependencies = announcementHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  const version = expectedVersion(event)
  const input = await readValidatedJsonBody(event, withdrawAnnouncementRequestSchema)
  const result = await runAnnouncementOperation(() => dependencies.announcements.withdraw(subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    contestId,
    announcementId,
    expectedVersion: version,
    reason: input.reason,
  }))
  return mutationResponse(event, result)
}

export async function handleListManagedAnnouncements(
  event: H3Event,
  contestId: string,
  dependencies = announcementHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  const input = announcementListRequestSchema.parse(getQuery(event))
  const result = await runAnnouncementOperation(() => dependencies.announcements.listManaged(
    subject,
    contestId,
    input.cursor,
    input.limit,
  ))
  return announcementListResponseSchema.parse({
    items: result.items.map(projection),
    page: { next_cursor: result.nextCursor, has_more: result.hasMore },
  })
}

export async function handleListPublicAnnouncements(
  event: H3Event,
  contestId: string,
  dependencies: Pick<AnnouncementHttpDependencies, 'announcements'>,
) {
  const input = announcementListRequestSchema.parse(getQuery(event))
  const result = await runAnnouncementOperation(() => dependencies.announcements.listPublic(
    contestId,
    input.cursor,
    input.limit,
  ))
  return announcementListResponseSchema.parse({
    items: result.items.map(projection),
    page: { next_cursor: result.nextCursor, has_more: result.hasMore },
  })
}
