import type { H3Event } from 'h3'
import { getHeader, setResponseHeader, setResponseStatus } from 'h3'
import {
  contestLifecycleRequestSchema,
  contestResponseSchema,
  contestPublicationCheckResponseSchema,
  createContestDraftRequestSchema,
  updateContestDraftRequestSchema,
  type Contest,
} from '../../../shared/contracts/contests'
import {
  entityTagForVersion,
  requestIdSchema,
  versionFromIfMatch,
} from '../../../shared/contracts/http'
import { identityCapability } from '../../domains/identity/capabilities'
import {
  assertImplicitJeopardyContestPayload,
  ContestModeUnsupportedError,
} from '../../domains/contests/admission'
import type { ContestRecord } from '../../domains/contests/repository'
import { ContestServiceError, type ContestService } from '../../domains/contests/service'
import {
  identityHttpDependencies,
  requireProtectedCapability,
  type IdentityHttpDependencies,
} from '../auth/identity-http'
import { readJsonBody, readValidatedJsonBody } from '../http/body'
import { createApiError } from '../http/errors'

type ContestCommands = Pick<ContestService,
  'archive' | 'checkPublication' | 'createDraft' | 'publish' | 'readManaged' | 'readPublic' | 'updateDraft'>
type PublicContestQueries = Pick<ContestService, 'readPublic'>

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
    visibility: record.visibility,
    invite_required: record.inviteRequired,
    invite_configured: record.inviteConfigured,
    registration_strategy: record.registrationStrategy,
    start_at: record.startAt.toISOString(),
    end_at: record.endAt.toISOString(),
    scoreboard_freeze_at: record.scoreboardFreezeAt?.toISOString() ?? null,
    practice_enabled: record.practiceEnabled,
    writeup_required: record.writeupRequired,
    writeup_deadline_at: record.writeupDeadlineAt?.toISOString() ?? null,
    min_team_size: record.minTeamSize,
    max_team_size: record.maxTeamSize,
    registration_constraints: {
      allowed_email_domains: record.registrationConstraints.allowedEmailDomains,
    },
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
    if (error.code === 'contest.configuration_invalid') {
      throw createApiError(400, 'validation.failed', '请求字段无效', error.fields)
    }
    const statusCode = {
      'contest.configuration_locked': 409,
      'contest.not_ended': 409,
      'contest.not_found': 404,
      'contest.slug_conflict': 409,
      'contest.transition_invalid': 409,
      'contest.publication_check_failed': 409,
      'resource.version_conflict': 409,
    }[error.code]
    throw createApiError(statusCode, error.code, error.message, error.fields)
  }
}

function respond(event: H3Event, record: ContestRecord) {
  setResponseHeader(event, 'etag', entityTagForVersion(record.version))
  return contestResponseSchema.parse({ contest: projection(record) })
}

async function readContestJsonBody<Output>(event: H3Event, schema: { parse(value: unknown): Output }) {
  const payload = await readJsonBody(event)
  try {
    assertImplicitJeopardyContestPayload(payload, 'api')
  }
  catch (error) {
    if (!(error instanceof ContestModeUnsupportedError)) throw error
    throw createApiError(400, 'contest.mode_unsupported', error.message, {
      [error.field]: ['首期比赛不得声明赛制字段'],
    })
  }
  return schema.parse(payload)
}

export async function handleCreateContestDraft(
  event: H3Event,
  dependencies = contestHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  const input = await readContestJsonBody(event, createContestDraftRequestSchema)
  const result = await runContestOperation(() => dependencies.contests.createDraft(subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    title: input.title,
    slug: input.slug,
    description: input.description,
    visibility: input.visibility,
    inviteRequired: input.invite_required,
    inviteCode: input.invite_code,
    registrationStrategy: input.registration_strategy,
    startAt: new Date(input.start_at),
    endAt: new Date(input.end_at),
    scoreboardFreezeAt: input.scoreboard_freeze_at ? new Date(input.scoreboard_freeze_at) : null,
    practiceEnabled: input.practice_enabled,
    writeupRequired: input.writeup_required,
    writeupDeadlineAt: input.writeup_deadline_at ? new Date(input.writeup_deadline_at) : null,
    minTeamSize: input.min_team_size,
    maxTeamSize: input.max_team_size,
    allowedEmailDomains: input.registration_constraints.allowed_email_domains,
  }))
  setResponseStatus(event, 201)
  return respond(event, result)
}

export async function handleUpdateContestDraft(
  event: H3Event,
  contestId: string,
  dependencies = contestHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  const expectedVersion = versionFromIfMatch(getHeader(event, 'if-match'))
  if (expectedVersion === null) {
    throw createApiError(428, 'resource.precondition_required', '需要有效的 If-Match 资源版本', {
      if_match: ['请提交当前资源的强 ETag，例如 "3"'],
    })
  }
  const input = await readContestJsonBody(event, updateContestDraftRequestSchema)
  const result = await runContestOperation(() => dependencies.contests.updateDraft(subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    contestId,
    expectedVersion,
    reason: input.reason,
    title: input.title,
    slug: input.slug,
    description: input.description,
    visibility: input.visibility,
    inviteRequired: input.invite_required,
    inviteCode: input.invite_code,
    registrationStrategy: input.registration_strategy,
    startAt: input.start_at ? new Date(input.start_at) : undefined,
    endAt: input.end_at ? new Date(input.end_at) : undefined,
    scoreboardFreezeAt: input.scoreboard_freeze_at === undefined
      ? undefined
      : input.scoreboard_freeze_at === null ? null : new Date(input.scoreboard_freeze_at),
    practiceEnabled: input.practice_enabled,
    writeupRequired: input.writeup_required,
    writeupDeadlineAt: input.writeup_deadline_at === undefined
      ? undefined
      : input.writeup_deadline_at === null ? null : new Date(input.writeup_deadline_at),
    minTeamSize: input.min_team_size,
    maxTeamSize: input.max_team_size,
    allowedEmailDomains: input.registration_constraints?.allowed_email_domains,
  }))
  return respond(event, result)
}

export async function handleManagedContest(
  event: H3Event,
  contestId: string,
  dependencies = contestHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  const result = await runContestOperation(() => dependencies.contests.readManaged(subject, contestId))
  return respond(event, result)
}

export async function handlePublicContest(
  _event: H3Event,
  contestId: string,
  dependencies: { contests: PublicContestQueries },
) {
  const result = await readPublicContest(contestId, dependencies)
  return respond(_event, result)
}

export async function readPublicContest(
  contestId: string,
  dependencies: { contests: PublicContestQueries },
) {
  return runContestOperation(() => dependencies.contests.readPublic(contestId))
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
  return respond(event, result)
}

export async function handleContestPublicationCheck(
  event: H3Event,
  contestId: string,
  dependencies = contestHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  const result = await runContestOperation(() => dependencies.contests.checkPublication(subject, contestId))
  return contestPublicationCheckResponseSchema.parse({
    ready: result.ready,
    issues: result.issues.map(issue => ({
      code: issue.code,
      message: issue.message,
      resource_type: issue.resourceType,
      resource_id: issue.resourceId,
      resource_title: issue.resourceTitle,
      field: issue.field,
    })),
  })
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
  return respond(event, result)
}
