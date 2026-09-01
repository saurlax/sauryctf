import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import {
  scoreboardQuerySchema,
  scoreboardResponseSchema,
} from '../../../shared/contracts/scoreboards'
import { identityCapability } from '../../domains/identity/capabilities'
import type { SessionSubject } from '../../domains/identity/repository'
import type { ScoreboardScope } from '../../domains/scoreboards/builder'
import {
  ScoreboardViewServiceError,
  type ScoreboardProjection,
  type ScoreboardViewService,
} from '../../domains/scoreboards/view-service'
import { ScoringReplayContestNotFoundError } from '../../domains/submissions/scoring-replay'
import {
  identityHttpDependencies,
  requireProtectedCapability,
  type IdentityHttpDependencies,
} from '../auth/identity-http'
import { createApiError } from '../http/errors'

type ScoreboardQueries = Pick<ScoreboardViewService, 'read'>

export interface ScoreboardHttpDependencies {
  identity: IdentityHttpDependencies
  scoreboards: ScoreboardQueries
}

export function scoreboardHttpDependencies(event: H3Event): ScoreboardHttpDependencies {
  if (!event.context.services) {
    throw createApiError(503, 'platform.not_ready', '控制面数据库服务尚未就绪')
  }
  return {
    identity: identityHttpDependencies(event),
    scoreboards: event.context.services.scoreboards,
  }
}

export async function handlePublicScoreboard(
  event: H3Event,
  contestId: string,
  dependencies = scoreboardHttpDependencies(event),
) {
  return handleRead(event, contestId, 'public', { role: 'user' }, dependencies)
}

export async function handleInternalScoreboard(
  event: H3Event,
  contestId: string,
  dependencies = scoreboardHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contestManage,
    dependencies.identity,
  )
  return handleRead(event, contestId, 'internal', context.subject, dependencies)
}

async function handleRead(
  event: H3Event,
  contestId: string,
  view: 'public' | 'internal',
  subject: Pick<SessionSubject, 'role'>,
  dependencies: ScoreboardHttpDependencies,
) {
  const input = scoreboardQuerySchema.parse(getQuery(event))
  const scope: ScoreboardScope = input.division_id
    ? { type: 'division', divisionId: input.division_id }
    : { type: 'overall' }
  try {
    return response(await dependencies.scoreboards.read({
      contestId,
      view,
      viewerRole: subject.role,
      scope,
    }))
  }
  catch (error) {
    if (error instanceof ScoringReplayContestNotFoundError) {
      throw createApiError(404, 'scoreboard.not_found', '排行榜不存在或尚未公开')
    }
    if (!(error instanceof ScoreboardViewServiceError)) throw error
    const statusCode = {
      'scoreboard.not_found': 404,
      'scoreboard.internal_forbidden': 403,
      'scoreboard.scope_invalid': 400,
      'scoreboard.time_invalid': 500,
    }[error.code]
    throw createApiError(
      statusCode,
      error.code,
      error.message,
      error.code === 'scoreboard.scope_invalid' ? { division_id: [error.message] } : {},
    )
  }
}

function response(projection: ScoreboardProjection) {
  return scoreboardResponseSchema.parse({
    scoreboard: {
      schema: projection.schema,
      contest_id: projection.contestId,
      view: projection.view,
      state: projection.state,
      freshness: projection.freshness,
      version: projection.version,
      frozen_at: projection.frozenAt,
      built_at: projection.builtAt,
      scope: projection.board.scope.type === 'overall'
        ? { type: 'overall' }
        : { type: 'division', division_id: projection.board.scope.divisionId },
      challenges: projection.board.challenges.map(challenge => ({
        challenge_id: challenge.challengeId,
        official_solve_count: challenge.officialSolveCount,
        current_points: challenge.currentPoints,
        first_solve_participation_id: challenge.firstSolveParticipationId,
      })),
      rows: projection.board.rows.map(row => ({
        rank: row.rank,
        participation_id: row.participationId,
        team_id: row.teamId,
        team_name: row.teamName,
        division_id: row.divisionId,
        total_points: row.totalPoints,
        solve_points: row.solvePoints,
        adjustment_points: row.adjustmentPoints,
        official_solve_count: row.officialSolveCount,
        last_scoring_at: row.lastScoringAt,
        solves: row.solves.map(solve => ({
          solve_id: solve.solveId,
          challenge_id: solve.challengeId,
          solved_at: solve.solvedAt,
        })),
      })),
    },
  })
}
