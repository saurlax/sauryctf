import { describe, expect, it } from 'vitest'
import type {
  ContestScoringReplay,
  ReplayedParticipationScore,
} from '../submissions/scoring-replay'
import { ScoreboardBuilder, ScoreboardBuildInputError } from './builder'

const earlier = '2026-09-01T08:00:00.000Z'
const later = '2026-09-01T08:01:00.000Z'

function score(input: Partial<ReplayedParticipationScore> & {
  participationId: string
  totalPoints: number
}): ReplayedParticipationScore {
  return {
    participationId: input.participationId,
    teamId: input.teamId ?? `team-${input.participationId}`,
    teamName: input.teamName ?? input.participationId,
    divisionId: input.divisionId ?? null,
    status: input.status ?? 'accepted',
    solves: input.solves ?? [],
    officialSolveCount: input.officialSolveCount ?? 0,
    solvePoints: input.solvePoints ?? 0,
    adjustmentPoints: input.adjustmentPoints ?? input.totalPoints,
    totalPoints: input.totalPoints,
    lastScoringAt: input.lastScoringAt ?? null,
  }
}

function replay(): ContestScoringReplay {
  return {
    schema: 'contest-scoring-replay.v1',
    challengeScores: [
      {
        challengeId: 'challenge-b',
        officialSolveCount: 0,
        currentPoints: 200,
        firstSolve: null,
      },
      {
        challengeId: 'challenge-a',
        officialSolveCount: 1,
        currentPoints: 500,
        firstSolve: {
          solveId: 'solve-a',
          submissionId: 'submission-a',
          participationId: 'participation-d',
          solvedAt: earlier,
        },
      },
    ],
    participationScores: [
      score({ participationId: 'participation-a', divisionId: 'division-1', totalPoints: 500, lastScoringAt: later }),
      score({ participationId: 'participation-e', divisionId: 'division-2', totalPoints: 0 }),
      score({
        participationId: 'participation-c',
        teamId: 'team-a',
        divisionId: 'division-2',
        totalPoints: 500,
        lastScoringAt: earlier,
      }),
      score({ participationId: 'participation-z', divisionId: 'division-1', totalPoints: 9_999, status: 'rejected' }),
      score({ participationId: 'participation-d', divisionId: 'division-1', totalPoints: 600, lastScoringAt: later }),
      score({
        participationId: 'participation-b',
        teamId: 'team-z',
        divisionId: 'division-1',
        totalPoints: 500,
        lastScoringAt: earlier,
      }),
    ],
    rankingSummary: [],
  }
}

describe('scoreboard read-model builder', () => {
  it('builds the overall board with deterministic score, time, and stable-id ordering', () => {
    const board = new ScoreboardBuilder().build(replay(), { type: 'overall' })
    expect(board.scopeKey).toBe('overall')
    expect(board.rows.map(row => [row.rank, row.participationId])).toEqual([
      [1, 'participation-d'],
      [2, 'participation-c'],
      [3, 'participation-b'],
      [4, 'participation-a'],
      [5, 'participation-e'],
    ])
    expect(board.rows.every(row => row.participationId !== 'participation-z')).toBe(true)
    expect(board.challenges).toEqual([
      {
        challengeId: 'challenge-a',
        officialSolveCount: 1,
        currentPoints: 500,
        firstSolveParticipationId: 'participation-d',
      },
      {
        challengeId: 'challenge-b',
        officialSolveCount: 0,
        currentPoints: 200,
        firstSolveParticipationId: null,
      },
    ])
  })

  it('filters one division without changing global challenge values and reranks from one', () => {
    const board = new ScoreboardBuilder().build(replay(), {
      type: 'division',
      divisionId: 'division-1',
    })
    expect(board).toMatchObject({
      schema: 'scoreboard.v1',
      scope: { type: 'division', divisionId: 'division-1' },
      scopeKey: 'division-1',
      challenges: [
        { challengeId: 'challenge-a', currentPoints: 500 },
        { challengeId: 'challenge-b', currentPoints: 200 },
      ],
    })
    expect(board.rows.map(row => [row.rank, row.participationId])).toEqual([
      [1, 'participation-d'],
      [2, 'participation-b'],
      [3, 'participation-a'],
    ])
  })

  it('returns the identical serialized board when replay participation order changes', () => {
    const builder = new ScoreboardBuilder()
    const firstReplay = replay()
    const reordered = replay()
    reordered.participationScores.reverse()
    reordered.challengeScores.reverse()
    const first = builder.build(firstReplay, { type: 'overall' })
    const second = builder.build(reordered, { type: 'overall' })
    expect(second).toEqual(first)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('rejects invalid division scopes and inconsistent solve summaries', () => {
    const builder = new ScoreboardBuilder()
    expect(() => builder.build(replay(), { type: 'division', divisionId: '  ' }))
      .toThrow(ScoreboardBuildInputError)

    const inconsistent = replay()
    inconsistent.participationScores[0]!.officialSolveCount = 1
    expect(() => builder.build(inconsistent, { type: 'overall' }))
      .toThrow(ScoreboardBuildInputError)
  })
})
