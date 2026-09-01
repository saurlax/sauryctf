import type { H3Event } from 'h3'
import { setResponseStatus } from 'h3'
import {
  adminTeamCorrectionRequestSchema,
  createTeamRequestSchema,
  inviteRotatedResponseSchema,
  joinTeamRequestSchema,
  memberRemovedResponseSchema,
  teamLeftResponseSchema,
  teamMutationResponseSchema,
  teamResponseSchema,
  transferCaptainRequestSchema,
  type Team,
} from '../../../shared/contracts/teams'
import { requestIdSchema } from '../../../shared/contracts/http'
import { identityCapability } from '../../domains/identity/capabilities'
import type { TeamRecord } from '../../domains/teams/repository'
import { TeamServiceError, type TeamService } from '../../domains/teams/service'
import {
  identityHttpDependencies,
  requireProtectedCapability,
  type IdentityHttpDependencies,
} from '../auth/identity-http'
import { readValidatedJsonBody } from '../http/body'
import { createApiError } from '../http/errors'

type TeamCommands = Pick<TeamService,
  | 'create'
  | 'correctMembership'
  | 'current'
  | 'join'
  | 'leave'
  | 'remove'
  | 'rotateInvite'
  | 'transfer'>

export interface TeamHttpDependencies {
  identity: IdentityHttpDependencies
  teams: TeamCommands
}

export function teamHttpDependencies(event: H3Event): TeamHttpDependencies {
  if (!event.context.services) {
    throw createApiError(503, 'platform.not_ready', '控制面数据库服务尚未就绪')
  }
  return {
    identity: identityHttpDependencies(event),
    teams: event.context.services.teams,
  }
}

function projection(record: TeamRecord, inviteCode: string | null = null): Team {
  return {
    id: record.id,
    name: record.name,
    version: record.version,
    invite_code: inviteCode,
    members: record.members.map(member => ({
      user_id: member.userId,
      username: member.username,
      role: member.role,
      joined_at: member.joinedAt.toISOString(),
    })),
    lock: {
      locked: record.locks.length > 0,
      contests: record.locks.map(lock => ({
        id: lock.id,
        title: lock.title,
        start_at: lock.startAt.toISOString(),
        end_at: lock.endAt.toISOString(),
      })),
    },
  }
}

async function administrator(event: H3Event, dependencies: TeamHttpDependencies) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.globalOperationsManage,
    dependencies.identity,
  )
  return context.subject
}

async function actor(event: H3Event, dependencies: TeamHttpDependencies) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.teamWrite,
    dependencies.identity,
  )
  return context.subject
}

async function runTeamOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (!(error instanceof TeamServiceError)) throw error
    const statusCode = {
      'team.conflict': 409,
      'team.forbidden': 403,
      'team.invite_invalid': 400,
      'team.locked': 409,
      'team.member_ineligible': 409,
      'team.not_found': 404,
      'team.reason_required': 400,
    }[error.code]
    const fields: Record<string, string[]> = error.code === 'team.locked'
      ? { contests: error.locks.map(lock => `${lock.title} · ${lock.endAt.toISOString()}`) }
      : {}
    throw createApiError(statusCode, error.code, error.message, fields)
  }
}

export async function handleCurrentTeam(
  event: H3Event,
  dependencies = teamHttpDependencies(event),
) {
  const subject = await actor(event, dependencies)
  const team = await runTeamOperation(() => dependencies.teams.current(subject))
  return teamResponseSchema.parse({ team: team ? projection(team) : null })
}

export async function handleCreateTeam(
  event: H3Event,
  dependencies = teamHttpDependencies(event),
) {
  const subject = await actor(event, dependencies)
  const input = await readValidatedJsonBody(event, createTeamRequestSchema)
  const result = await runTeamOperation(() => dependencies.teams.create(subject, input.name))
  setResponseStatus(event, 201)
  return teamMutationResponseSchema.parse({
    team: projection(result.team, result.inviteCode),
  })
}

export async function handleJoinTeam(
  event: H3Event,
  dependencies = teamHttpDependencies(event),
) {
  const subject = await actor(event, dependencies)
  const input = await readValidatedJsonBody(event, joinTeamRequestSchema)
  const result = await runTeamOperation(() => dependencies.teams.join(subject, input.invite_code))
  return teamMutationResponseSchema.parse({ team: projection(result) })
}

export async function handleLeaveTeam(
  event: H3Event,
  dependencies = teamHttpDependencies(event),
) {
  const subject = await actor(event, dependencies)
  await runTeamOperation(() => dependencies.teams.leave(subject))
  return teamLeftResponseSchema.parse({ left: true })
}

export async function handleRemoveMember(
  event: H3Event,
  memberId: string,
  dependencies = teamHttpDependencies(event),
) {
  const subject = await actor(event, dependencies)
  await runTeamOperation(() => dependencies.teams.remove(subject, memberId))
  return memberRemovedResponseSchema.parse({ removed: true })
}

export async function handleRotateInvite(
  event: H3Event,
  dependencies = teamHttpDependencies(event),
) {
  const subject = await actor(event, dependencies)
  const inviteCode = await runTeamOperation(() => dependencies.teams.rotateInvite(subject))
  return inviteRotatedResponseSchema.parse({ invite_code: inviteCode })
}

export async function handleTransferCaptain(
  event: H3Event,
  dependencies = teamHttpDependencies(event),
) {
  const subject = await actor(event, dependencies)
  const input = await readValidatedJsonBody(event, transferCaptainRequestSchema)
  await runTeamOperation(() => dependencies.teams.transfer(subject, input.user_id))
  const team = await runTeamOperation(() => dependencies.teams.current(subject))
  if (!team) throw createApiError(404, 'team.not_found', '当前队伍或成员不存在')
  return teamMutationResponseSchema.parse({ team: projection(team) })
}

export async function handleCorrectTeamMembership(
  event: H3Event,
  teamId: string,
  dependencies = teamHttpDependencies(event),
) {
  const subject = await administrator(event, dependencies)
  const input = await readValidatedJsonBody(event, adminTeamCorrectionRequestSchema)
  const team = await runTeamOperation(() => dependencies.teams.correctMembership(subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    teamId,
    operation: input.operation,
    targetUserId: input.user_id,
    reason: input.reason,
  }))
  return teamMutationResponseSchema.parse({ team: projection(team) })
}
