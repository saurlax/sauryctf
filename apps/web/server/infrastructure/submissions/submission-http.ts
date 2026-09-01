import type { H3Event } from 'h3'
import { setResponseHeader } from 'h3'
import {
  submitFlagRequestSchema,
  submitFlagResponseSchema,
} from '../../../shared/contracts/submissions'
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

type SubmissionCommands = Pick<SubmissionService, 'verifyFlag'>

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
  const verdict = await runOperation(event, () => dependencies.submissions.verifyFlag(context.subject, {
    contestId,
    challengeId,
    submittedFlag: input.flag,
  }))
  return submitFlagResponseSchema.parse({
    result: verdict.correct ? 'correct' : 'incorrect',
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
      'participation.not_accepted': 403,
      'security.rate_limited': 429,
      'team.membership_required': 403,
    }[error.code]
    throw createApiError(statusCode, error.code, error.message)
  }
}
