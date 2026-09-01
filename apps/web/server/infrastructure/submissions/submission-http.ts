import type { H3Event } from 'h3'
import { getQuery, setResponseHeader } from 'h3'
import {
  cheatClueListRequestSchema,
  cheatClueListResponseSchema,
  managedSubmissionListRequestSchema,
  managedSubmissionListResponseSchema,
  recordScoreAdjustmentRequestSchema,
  recordScoreAdjustmentResponseSchema,
  reviewCheatClueRequestSchema,
  reviewCheatClueResponseSchema,
  submitFlagRequestSchema,
  submitFlagResponseSchema,
} from '../../../shared/contracts/submissions'
import { requestIdSchema } from '../../../shared/contracts/http'
import { identityCapability } from '../../domains/identity/capabilities'
import {
  SubmissionServiceError,
  type SubmissionService,
} from '../../domains/submissions/service'
import {
  identityHttpDependencies,
  requireProtectedCapability,
  type IdentityHttpDependencies,
} from '../auth/identity-http'
import { readValidatedJsonBody } from '../http/body'
import { createApiError } from '../http/errors'
import { enforceFlagSubmissionNetworkRateLimits } from '../security/request-security'

type SubmissionCommands = Pick<SubmissionService,
  | 'listManaged'
  | 'listCheatClues'
  | 'recordScoreAdjustment'
  | 'reviewCheatClue'
  | 'verifyFlag'>

export interface SubmissionHttpDependencies {
  identity: IdentityHttpDependencies
  submissions: SubmissionCommands
}

export function submissionHttpDependencies(event: H3Event): SubmissionHttpDependencies {
  if (!event.context.services) {
    throw createApiError(503, 'platform.not_ready', '控制面数据库服务尚未就绪')
  }
  return {
    identity: identityHttpDependencies(event),
    submissions: event.context.services.submissions,
  }
}

export async function handleSubmitFlag(
  event: H3Event,
  contestId: string,
  challengeId: string,
  dependencies = submissionHttpDependencies(event),
) {
  await enforceFlagSubmissionNetworkRateLimits(
    event,
    dependencies.identity.rateLimits,
    challengeId,
  )
  const context = await requireProtectedCapability(
    event,
    identityCapability.flagSubmit,
    dependencies.identity,
  )
  const input = await readValidatedJsonBody(event, submitFlagRequestSchema)
  const outcome = await runOperation(event, () => dependencies.submissions.verifyFlag(context.subject, {
    contestId,
    challengeId,
    submittedFlag: input.flag,
    requestId: requestIdSchema.parse(event.context.requestId),
  }))
  event.context.telemetry?.recordSubmission(outcome.result, outcome.mode)
  return submitFlagResponseSchema.parse({
    result: outcome.result,
    mode: outcome.mode,
  })
}

export async function handleListManagedSubmissions(
  event: H3Event,
  contestId: string,
  dependencies = submissionHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contestJudge,
    dependencies.identity,
  )
  const query = managedSubmissionListRequestSchema.parse(getQuery(event))
  const result = await runOperation(event, () => dependencies.submissions.listManaged(
    context.subject,
    contestId,
    query.cursor,
    query.limit,
  ))
  return managedSubmissionListResponseSchema.parse({
    items: result.items.map(item => ({
      id: item.id,
      contest_id: item.contestId,
      challenge_id: item.challengeId,
      participation_id: item.participationId,
      user_id: item.userId,
      mode: item.mode,
      result: item.result,
      answer_masked: '••••••••',
      submitted_at: item.submittedAt.toISOString(),
    })),
    page: { next_cursor: result.nextCursor, has_more: result.hasMore },
  })
}

export async function handleRecordScoreAdjustment(
  event: H3Event,
  contestId: string,
  dependencies = submissionHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contestJudge,
    dependencies.identity,
  )
  const input = await readValidatedJsonBody(event, recordScoreAdjustmentRequestSchema)
  const adjustment = await runOperation(event, () => dependencies.submissions.recordScoreAdjustment(
    context.subject,
    {
      contestId,
      participationId: input.participation_id,
      pointsDelta: input.points_delta,
      reason: input.reason,
      confirmed: input.confirm,
      requestId: requestIdSchema.parse(event.context.requestId),
    },
  ))
  return recordScoreAdjustmentResponseSchema.parse({
    adjustment: {
      id: adjustment.id,
      contest_id: adjustment.contestId,
      participation_id: adjustment.participationId,
      points_delta: adjustment.pointsDelta,
      reason: adjustment.reason,
      created_by: adjustment.createdBy,
      request_id: adjustment.requestId,
      created_at: adjustment.createdAt.toISOString(),
    },
  })
}

export async function handleListCheatClues(
  event: H3Event,
  contestId: string,
  dependencies = submissionHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contestJudge,
    dependencies.identity,
  )
  const query = cheatClueListRequestSchema.parse(getQuery(event))
  const result = await runOperation(event, () => dependencies.submissions.listCheatClues(
    context.subject,
    contestId,
    query.status,
    query.cursor,
    query.limit,
  ))
  return cheatClueListResponseSchema.parse({
    items: result.items.map(cheatClueProjection),
    page: { next_cursor: result.nextCursor, has_more: result.hasMore },
  })
}

export async function handleReviewCheatClue(
  event: H3Event,
  contestId: string,
  clueId: string,
  dependencies = submissionHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contestJudge,
    dependencies.identity,
  )
  const input = await readValidatedJsonBody(event, reviewCheatClueRequestSchema)
  const clue = await runOperation(event, () => dependencies.submissions.reviewCheatClue(
    context.subject,
    {
      contestId,
      clueId,
      status: input.status,
      note: input.review_note ?? null,
      requestId: requestIdSchema.parse(event.context.requestId),
    },
  ))
  return reviewCheatClueResponseSchema.parse({ clue: cheatClueProjection(clue) })
}

function cheatClueProjection(item: Awaited<ReturnType<SubmissionService['reviewCheatClue']>>) {
  return {
    id: item.id,
    contest_id: item.contestId,
    challenge_id: item.challengeId,
    participation_id: item.participationId,
    clue_type: item.clueType,
    evidence: item.evidence,
    status: item.status,
    reviewed_by: item.reviewedBy,
    review_note: item.reviewNote,
    reviewed_at: item.reviewedAt?.toISOString() ?? null,
    created_at: item.createdAt.toISOString(),
    updated_at: item.updatedAt.toISOString(),
  }
}

async function runOperation<T>(event: H3Event, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (!(error instanceof SubmissionServiceError)) throw error
    if (error.code === 'security.rate_limited') {
      setResponseHeader(event, 'retry-after', Math.max(1, Math.ceil(error.retryAfterMs / 1000)))
    }
    const statusCode = {
      'cheat_clue.cursor_invalid': 400,
      'cheat_clue.not_found': 404,
      'cheat_clue.request_conflict': 409,
      'cheat_clue.review_conflict': 409,
      'cheat_clue.review_note_required': 400,
      'challenge.flag_configuration_invalid': 503,
      'challenge.flag_validator_failed': 503,
      'challenge.not_found': 404,
      'challenge.submission_closed': 409,
      'challenge.submission_limit_reached': 409,
      'contest.not_running': 409,
      'contest.not_found': 404,
      'participation.not_accepted': 403,
      'participation.not_found': 404,
      'security.rate_limited': 429,
      'score.adjustment_confirmation_required': 400,
      'score.adjustment_invalid': 400,
      'score.adjustment_not_allowed': 409,
      'score.adjustment_reason_required': 400,
      'score.adjustment_request_conflict': 409,
      'team.membership_required': 403,
      'submission.cursor_invalid': 400,
      'submission.request_conflict': 409,
    }[error.code]
    throw createApiError(statusCode, error.code, error.message)
  }
}
