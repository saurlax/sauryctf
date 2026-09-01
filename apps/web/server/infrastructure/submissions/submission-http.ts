import type { H3Event } from 'h3'
import { getQuery, setResponseHeader } from 'h3'
import {
  managedSubmissionListRequestSchema,
  managedSubmissionListResponseSchema,
  recordScoreAdjustmentRequestSchema,
  recordScoreAdjustmentResponseSchema,
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
  | 'recordScoreAdjustment'
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
