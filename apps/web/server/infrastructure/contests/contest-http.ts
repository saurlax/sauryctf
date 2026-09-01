import type { H3Event } from 'h3'
import { setResponseStatus } from 'h3'
import {
  contestLifecycleRequestSchema,
  contestResponseSchema,
  createContestDraftRequestSchema,
  type Contest,
} from '../../../shared/contracts/contests'
import { requestIdSchema } from '../../../shared/contracts/http'
import { identityCapability } from '../../domains/identity/capabilities'
import type { ContestRecord } from '../../domains/contests/repository'
import { ContestServiceError, type ContestService } from '../../domains/contests/service'
import {
  identityHttpDependencies,
  requireProtectedCapability,
  type IdentityHttpDependencies,
} from '../auth/identity-http'
import { readValidatedJsonBody } from '../http/body'
import { createApiError } from '../http/errors'

type ContestCommands = Pick<ContestService,
  'archive' | 'createDraft' | 'publish' | 'readManaged' | 'readPublic'>

export interface ContestHttpDependencies {
  identity: IdentityHttpDependencies
  contests: ContestCommands
}

export function contestHttpDependencies(event: H3Event): ContestHttpDependencies {
  if (!event.context.services) {
    throw createApiError(503, 'platform.not_ready', '控制面数据库服务尚未就绪')
  }
  return {
    identity: identityHttpDependencies(event),
    contests: event.context.services.contests,
  }
}

function projection(record: ContestRecord): Contest {
  return {
    id: record.id,
    title: record.title,
    slug: record.slug,
    description: record.description,
    publication_status: record.publicationStatus,
    phase: record.phase,
    start_at: record.startAt.toISOString(),
    end_at: record.endAt.toISOString(),
    published_at: record.publishedAt?.toISOString() ?? null,
    archived_at: record.archivedAt?.toISOString() ?? null,
    version: record.version,
  }
}

async function manager(event: H3Event, dependencies: ContestHttpDependencies) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contestManage,
    dependencies.identity,
  )
  return context.subject
}

async function runContestOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (!(error instanceof ContestServiceError)) throw error
    const statusCode = {
      'contest.not_ended': 409,
      'contest.not_found': 404,
      'contest.slug_conflict': 409,
      'contest.transition_invalid': 409,
    }[error.code]
    throw createApiError(statusCode, error.code, error.message)
  }
}

export async function handleCreateContestDraft(
  event: H3Event,
  dependencies = contestHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  const input = await readValidatedJsonBody(event, createContestDraftRequestSchema)
  const result = await runContestOperation(() => dependencies.contests.createDraft(subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    title: input.title,
    slug: input.slug,
    description: input.description,
    startAt: new Date(input.start_at),
    endAt: new Date(input.end_at),
  }))
  setResponseStatus(event, 201)
  return contestResponseSchema.parse({ contest: projection(result) })
}

export async function handleManagedContest(
  event: H3Event,
  contestId: string,
  dependencies = contestHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  const result = await runContestOperation(() => dependencies.contests.readManaged(subject, contestId))
  return contestResponseSchema.parse({ contest: projection(result) })
}

export async function handlePublicContest(
  _event: H3Event,
  contestId: string,
  dependencies: Pick<ContestHttpDependencies, 'contests'>,
) {
  const result = await runContestOperation(() => dependencies.contests.readPublic(contestId))
  return contestResponseSchema.parse({ contest: projection(result) })
}

export async function handlePublishContest(
  event: H3Event,
  contestId: string,
  dependencies = contestHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  const input = await readValidatedJsonBody(event, contestLifecycleRequestSchema)
  const result = await runContestOperation(() => dependencies.contests.publish(subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    contestId,
    reason: input.reason,
  }))
  return contestResponseSchema.parse({ contest: projection(result) })
}

export async function handleArchiveContest(
  event: H3Event,
  contestId: string,
  dependencies = contestHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  const input = await readValidatedJsonBody(event, contestLifecycleRequestSchema)
  const result = await runContestOperation(() => dependencies.contests.archive(subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    contestId,
    reason: input.reason,
  }))
  return contestResponseSchema.parse({ contest: projection(result) })
}
