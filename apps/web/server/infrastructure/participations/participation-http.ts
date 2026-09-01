import type { H3Event } from 'h3'
import { getQuery, setResponseStatus } from 'h3'
import {
  adminParticipationListRequestSchema,
  adminParticipationListResponseSchema,
  assignParticipationDivisionRequestSchema,
  currentParticipationResponseSchema,
  participationMutationResponseSchema,
  registerParticipationRequestSchema,
  reviewParticipationRequestSchema,
  type Participation,
} from '../../../shared/contracts/participations'
import { requestIdSchema } from '../../../shared/contracts/http'
import { identityCapability } from '../../domains/identity/capabilities'
import type { ParticipationRecord } from '../../domains/participations/repository'
import { ParticipationServiceError, type ParticipationService } from '../../domains/participations/service'
import {
  identityHttpDependencies,
  requireProtectedCapability,
  type IdentityHttpDependencies,
} from '../auth/identity-http'
import { readValidatedJsonBody } from '../http/body'
import { createApiError } from '../http/errors'

type ParticipationCommands = Pick<ParticipationService,
  | 'assignDivision'
  | 'current'
  | 'list'
  | 'register'
  | 'review'
  | 'withdraw'>

export interface ParticipationHttpDependencies {
  identity: IdentityHttpDependencies
  participations: ParticipationCommands
}

export function participationHttpDependencies(event: H3Event): ParticipationHttpDependencies {
  if (!event.context.services) {
    throw createApiError(503, 'platform.not_ready', '控制面数据库服务尚未就绪')
  }
  return {
    identity: identityHttpDependencies(event),
    participations: event.context.services.participations,
  }
}

function projection(record: ParticipationRecord): Participation {
  return {
    id: record.id,
    contest_id: record.contestId,
    team: { id: record.teamId, name: record.teamName },
    division: record.divisionId && record.divisionName
      ? { id: record.divisionId, name: record.divisionName }
      : null,
    status: record.status,
    registered_at: record.registeredAt.toISOString(),
    reviewed_at: record.reviewedAt?.toISOString() ?? null,
    review_reason: record.reviewReason,
    withdrawn_at: record.withdrawnAt?.toISOString() ?? null,
    version: record.version,
  }
}

async function participant(event: H3Event, dependencies: ParticipationHttpDependencies) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contestRegister,
    dependencies.identity,
  )
  return context.subject
}

async function reader(event: H3Event, dependencies: ParticipationHttpDependencies) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.publicBrowse,
    dependencies.identity,
  )
  return context.subject
}

async function judge(event: H3Event, dependencies: ParticipationHttpDependencies) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contestJudge,
    dependencies.identity,
  )
  return context.subject
}

async function runParticipationOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (!(error instanceof ParticipationServiceError)) throw error
    const statusCode = {
      'participation.configuration_invalid': 409,
      'participation.conflict': 409,
      'participation.contest_not_found': 404,
      'participation.division_invalid': 400,
      'participation.email_domain_forbidden': 409,
      'participation.invite_invalid': 400,
      'participation.member_ineligible': 409,
      'participation.not_found': 404,
      'participation.registration_closed': 409,
      'participation.team_required': 409,
      'participation.team_size_invalid': 409,
      'participation.transition_invalid': 409,
    }[error.code]
    throw createApiError(statusCode, error.code, error.message, error.fields)
  }
}

export async function handleCurrentParticipation(
  event: H3Event,
  contestId: string,
  dependencies = participationHttpDependencies(event),
) {
  const subject = await reader(event, dependencies)
  const result = await runParticipationOperation(() => dependencies.participations.current(subject, contestId))
  return currentParticipationResponseSchema.parse({
    team: result.team,
    participation: result.participation ? projection(result.participation) : null,
  })
}

export async function handleRegisterParticipation(
  event: H3Event,
  contestId: string,
  dependencies = participationHttpDependencies(event),
) {
  const subject = await participant(event, dependencies)
  const input = await readValidatedJsonBody(event, registerParticipationRequestSchema)
  const result = await runParticipationOperation(() => dependencies.participations.register(
    subject,
    contestId,
    input.invite_code,
  ))
  setResponseStatus(event, 201)
  return participationMutationResponseSchema.parse({ participation: projection(result) })
}

export async function handleWithdrawParticipation(
  event: H3Event,
  contestId: string,
  dependencies = participationHttpDependencies(event),
) {
  const subject = await participant(event, dependencies)
  const result = await runParticipationOperation(() => dependencies.participations.withdraw(subject, contestId))
  return participationMutationResponseSchema.parse({ participation: projection(result) })
}

export async function handleListParticipations(
  event: H3Event,
  contestId: string,
  dependencies = participationHttpDependencies(event),
) {
  const subject = await judge(event, dependencies)
  const input = adminParticipationListRequestSchema.parse(getQuery(event))
  const result = await runParticipationOperation(() => dependencies.participations.list(
    subject,
    contestId,
    input.cursor,
    input.limit,
    input.status,
  ))
  return adminParticipationListResponseSchema.parse({
    items: result.items.map(projection),
    page: { next_cursor: result.nextCursor, has_more: result.hasMore },
  })
}

export async function handleReviewParticipation(
  event: H3Event,
  contestId: string,
  participationId: string,
  dependencies = participationHttpDependencies(event),
) {
  const subject = await judge(event, dependencies)
  const input = await readValidatedJsonBody(event, reviewParticipationRequestSchema)
  const result = await runParticipationOperation(() => dependencies.participations.review(subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    contestId,
    participationId,
    decision: input.decision,
    reason: input.reason,
  }))
  return participationMutationResponseSchema.parse({ participation: projection(result) })
}

export async function handleAssignParticipationDivision(
  event: H3Event,
  contestId: string,
  participationId: string,
  dependencies = participationHttpDependencies(event),
) {
  const subject = await judge(event, dependencies)
  const input = await readValidatedJsonBody(event, assignParticipationDivisionRequestSchema)
  const result = await runParticipationOperation(() => dependencies.participations.assignDivision(subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    contestId,
    participationId,
    divisionId: input.division_id,
    reason: input.reason,
  }))
  return participationMutationResponseSchema.parse({ participation: projection(result) })
}
