import type { H3Event } from 'h3'
import { getHeader, setResponseHeader, setResponseStatus } from 'h3'
import {
  contestChallengeResponseSchema,
  mountContestChallengeRequestSchema,
  playerContestChallengeListResponseSchema,
  playerContestChallengeResponseSchema,
  reviseContestChallengeRequestSchema,
  type ContestChallenge,
  type PlayerContestChallenge,
} from '../../../shared/contracts/challenges'
import { entityTagForVersion, requestIdSchema, versionFromIfMatch } from '../../../shared/contracts/http'
import type { ContestChallengeRecord } from '../../domains/challenges/contest-challenge-repository'
import {
  ContestChallengeServiceError,
  type ContestChallengeService,
  type PlayerContestChallengeProjection,
} from '../../domains/challenges/contest-challenge-service'
import { identityCapability } from '../../domains/identity/capabilities'
import {
  identityHttpDependencies,
  requireProtectedCapability,
  type IdentityHttpDependencies,
} from '../auth/identity-http'
import { readValidatedJsonBody } from '../http/body'
import { createApiError } from '../http/errors'

type ContestChallengeCommands = Pick<ContestChallengeService,
  'listForPlayer' | 'mount' | 'read' | 'readForPlayer' | 'revise'>

export interface ContestChallengeHttpDependencies {
  identity: IdentityHttpDependencies
  contestChallenges: ContestChallengeCommands
}

export function contestChallengeHttpDependencies(event: H3Event): ContestChallengeHttpDependencies {
  if (!event.context.services) {
    throw createApiError(503, 'platform.not_ready', '控制面数据库服务尚未就绪')
  }
  return {
    identity: identityHttpDependencies(event),
    contestChallenges: event.context.services.contestChallenges,
  }
}

async function manager(event: H3Event, dependencies: ContestChallengeHttpDependencies) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contestManage,
    dependencies.identity,
  )
  return context.subject
}

async function player(event: H3Event, dependencies: ContestChallengeHttpDependencies) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.publicBrowse,
    dependencies.identity,
  )
  return context.subject
}

async function runOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (!(error instanceof ContestChallengeServiceError)) throw error
    if (error.code === 'challenge.policy_invalid' || error.code === 'challenge.revision_reason_required') {
      throw createApiError(400, 'validation.failed', '请求字段无效', error.fields)
    }
    const statusCode = {
      'challenge.asset_unavailable': 409,
      'challenge.configuration_locked': 409,
      'challenge.contest_archived': 409,
      'challenge.not_found': 404,
      'challenge.revision_not_allowed': 409,
      'challenge.revision_unchanged': 409,
      'challenge.template_version_not_found': 404,
      'challenge.title_conflict': 409,
      'resource.version_conflict': 409,
    }[error.code]
    throw createApiError(statusCode, error.code, error.message, error.fields)
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

function projection(record: ContestChallengeRecord): ContestChallenge {
  return {
    id: record.id,
    contest_id: record.contestId,
    source_template_id: record.sourceTemplateId,
    source_version_id: record.sourceVersionId,
    source_version_number: record.sourceVersionNumber,
    snapshot_revision: record.snapshotRevision,
    title: record.title,
    category: record.category,
    description: record.description,
    flag_format: record.flagFormat,
    flag_policy: record.flagPolicy,
    scoring_policy: record.scoringPolicy,
    instance_policy: record.instancePolicy,
    assets: record.assets.map(asset => ({
      id: asset.id,
      content_object_id: asset.contentObjectId,
      display_name: asset.displayName,
      sort_order: asset.sortOrder,
    })),
    hints: record.hints.map(hint => ({
      id: hint.id,
      title: hint.title,
      content: hint.content,
      release_at: hint.releaseAt?.toISOString() ?? null,
      sort_order: hint.sortOrder,
    })),
    enabled: record.enabled,
    publish_at: record.publishAt?.toISOString() ?? null,
    close_at: record.closeAt?.toISOString() ?? null,
    submission_limit: record.submissionLimit,
    sort_order: record.sortOrder,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  }
}

function respond(event: H3Event, record: ContestChallengeRecord) {
  setResponseHeader(event, 'etag', entityTagForVersion(record.version))
  return contestChallengeResponseSchema.parse({ challenge: projection(record) })
}

function playerProjection(record: PlayerContestChallengeProjection): PlayerContestChallenge {
  const base = {
    id: record.id,
    contest_id: record.contestId,
    title: record.title,
    category: record.category,
    publish_at: record.publishAt?.toISOString() ?? null,
    close_at: record.closeAt?.toISOString() ?? null,
    sort_order: record.sortOrder,
    snapshot_revision: record.snapshotRevision,
    version: record.version,
  }
  if (!record.content) return { ...base, state: 'locked', content: null }
  const content = {
    description: record.content.description,
    flag_format: record.content.flagFormat,
    instance_type: record.content.instanceType,
    submission_limit: record.content.submissionLimit,
    assets: record.content.assets.map(asset => ({
      id: asset.id,
      display_name: asset.displayName,
      sort_order: asset.sortOrder,
    })),
    hints: record.content.hints.map(hint => ({
      id: hint.id,
      title: hint.title,
      content: hint.content,
      released_at: hint.releasedAt?.toISOString() ?? null,
      sort_order: hint.sortOrder,
    })),
  }
  return record.state === 'closed'
    ? { ...base, state: 'closed', content }
    : { ...base, state: 'open', content }
}

export async function handleMountContestChallenge(
  event: H3Event,
  contestId: string,
  dependencies = contestChallengeHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  const input = await readValidatedJsonBody(event, mountContestChallengeRequestSchema)
  const record = await runOperation(() => dependencies.contestChallenges.mount(subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    contestId,
    templateVersionId: input.template_version_id,
    enabled: input.enabled,
    publishAt: input.publish_at ? new Date(input.publish_at) : null,
    closeAt: input.close_at ? new Date(input.close_at) : null,
    submissionLimit: input.submission_limit,
    sortOrder: input.sort_order,
  }))
  setResponseStatus(event, 201)
  return respond(event, record)
}

export async function handleReadContestChallenge(
  event: H3Event,
  contestId: string,
  challengeId: string,
  dependencies = contestChallengeHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  return respond(event, await runOperation(() => dependencies.contestChallenges.read(
    subject,
    contestId,
    challengeId,
  )))
}

export async function handleListPlayerContestChallenges(
  event: H3Event,
  contestId: string,
  dependencies = contestChallengeHttpDependencies(event),
) {
  const subject = await player(event, dependencies)
  const result = await runOperation(() => dependencies.contestChallenges.listForPlayer(subject, contestId))
  return playerContestChallengeListResponseSchema.parse({ items: result.map(playerProjection) })
}

export async function handleReadPlayerContestChallenge(
  event: H3Event,
  contestId: string,
  challengeId: string,
  dependencies = contestChallengeHttpDependencies(event),
) {
  const subject = await player(event, dependencies)
  const result = await runOperation(() => dependencies.contestChallenges.readForPlayer(
    subject,
    contestId,
    challengeId,
  ))
  setResponseHeader(event, 'etag', entityTagForVersion(result.version))
  return playerContestChallengeResponseSchema.parse({ challenge: playerProjection(result) })
}

export async function handleReviseContestChallenge(
  event: H3Event,
  contestId: string,
  challengeId: string,
  dependencies = contestChallengeHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  const input = await readValidatedJsonBody(event, reviseContestChallengeRequestSchema)
  const record = await runOperation(() => dependencies.contestChallenges.revise(subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    contestId,
    challengeId,
    expectedVersion: expectedVersion(event),
    reason: input.reason,
    title: input.title,
    category: input.category,
    description: input.description,
    flagFormat: input.flag_format,
    flagPolicy: input.flag_policy,
    scoringPolicy: input.scoring_policy,
    instancePolicy: input.instance_policy,
    assets: input.assets?.map(asset => ({
      contentObjectId: asset.content_object_id,
      displayName: asset.display_name,
      sortOrder: asset.sort_order,
    })),
    hints: input.hints?.map(hint => ({
      title: hint.title,
      content: hint.content,
      releaseAt: hint.release_at ? new Date(hint.release_at) : null,
      sortOrder: hint.sort_order,
    })),
    enabled: input.enabled,
    publishAt: input.publish_at === undefined
      ? undefined
      : input.publish_at ? new Date(input.publish_at) : null,
    closeAt: input.close_at === undefined
      ? undefined
      : input.close_at ? new Date(input.close_at) : null,
    submissionLimit: input.submission_limit,
    sortOrder: input.sort_order,
  }))
  return respond(event, record)
}
