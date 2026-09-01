import {
  compareReplayedParticipationScores,
  type ContestScoringReplay,
  type ReplayedParticipationScore,
} from '../submissions/scoring-replay'

export type ScoreboardScope =
  | { type: 'overall' }
  | { type: 'division', divisionId: string }

export interface ScoreboardChallengeColumn {
  challengeId: string
  officialSolveCount: number
  currentPoints: number
  firstSolveParticipationId: string | null
}

export interface ScoreboardRow {
  rank: number
  participationId: string
  teamId: string
  teamName: string
  divisionId: string | null
  totalPoints: number
  solvePoints: number
  adjustmentPoints: number
  officialSolveCount: number
  lastScoringAt: string | null
  solves: Array<{
    solveId: string
    challengeId: string
    solvedAt: string
  }>
}

export interface ScoreboardReadModel {
  schema: 'scoreboard.v1'
  scope: ScoreboardScope
  scopeKey: string
  challenges: ScoreboardChallengeColumn[]
  rows: ScoreboardRow[]
}

export class ScoreboardBuildInputError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'ScoreboardBuildInputError'
  }
}

export class ScoreboardBuilder {
  build(replay: ContestScoringReplay, scope: ScoreboardScope): ScoreboardReadModel {
    if (scope.type === 'division' && scope.divisionId.trim().length === 0) {
      throw new ScoreboardBuildInputError('Division scope requires one stable division id')
    }
    const scopeKey = scope.type === 'overall' ? 'overall' : scope.divisionId
    const seenParticipations = new Set<string>()
    const candidates = replay.participationScores.filter((score) => {
      if (seenParticipations.has(score.participationId)) {
        throw new ScoreboardBuildInputError(`Duplicate participation ${score.participationId}`)
      }
      seenParticipations.add(score.participationId)
      return score.status === 'accepted'
        && (scope.type === 'overall' || score.divisionId === scope.divisionId)
    })
    const challengeIds = new Set(replay.challengeScores.map(challenge => challenge.challengeId))
    for (const score of candidates) this.validateSolves(score, challengeIds)

    const rows = candidates
      .toSorted(compareReplayedParticipationScores)
      .map<ScoreboardRow>((score, index) => ({
        rank: index + 1,
        participationId: score.participationId,
        teamId: score.teamId,
        teamName: score.teamName,
        divisionId: score.divisionId,
        totalPoints: score.totalPoints,
        solvePoints: score.solvePoints,
        adjustmentPoints: score.adjustmentPoints,
        officialSolveCount: score.officialSolveCount,
        lastScoringAt: score.lastScoringAt,
        solves: score.solves.map(solve => ({ ...solve })),
      }))

    return {
      schema: 'scoreboard.v1',
      scope: { ...scope },
      scopeKey,
      challenges: replay.challengeScores
        .toSorted((a, b) => a.challengeId.localeCompare(b.challengeId))
        .map(challenge => ({
          challengeId: challenge.challengeId,
          officialSolveCount: challenge.officialSolveCount,
          currentPoints: challenge.currentPoints,
          firstSolveParticipationId: challenge.firstSolve?.participationId ?? null,
        })),
      rows,
    }
  }

  private validateSolves(score: ReplayedParticipationScore, challengeIds: Set<string>) {
    if (score.solves.length !== score.officialSolveCount) {
      throw new ScoreboardBuildInputError(
        `Participation ${score.participationId} has inconsistent solve summaries`,
      )
    }
    const solvedChallenges = new Set<string>()
    for (const solve of score.solves) {
      if (!challengeIds.has(solve.challengeId)) {
        throw new ScoreboardBuildInputError(
          `Participation ${score.participationId} solved an unknown challenge`,
        )
      }
      if (solvedChallenges.has(solve.challengeId)) {
        throw new ScoreboardBuildInputError(
          `Participation ${score.participationId} has duplicate challenge solves`,
        )
      }
      solvedChallenges.add(solve.challengeId)
    }
  }
}
