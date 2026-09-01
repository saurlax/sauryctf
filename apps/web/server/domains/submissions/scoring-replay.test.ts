import { describe, expect, it, vi } from 'vitest'
import {
  ContestScoringReplayService,
  replayContestScoring,
  ScoringReplayInvariantError,
  type ContestScoringFacts,
} from './scoring-replay'

const t1 = new Date('2026-09-01T08:01:00.000Z')
const t2 = new Date('2026-09-01T08:02:00.000Z')
const t3 = new Date('2026-09-01T08:03:00.000Z')
const t4 = new Date('2026-09-01T08:04:00.000Z')
const t5 = new Date('2026-09-01T08:05:00.000Z')
const t6 = new Date('2026-09-01T08:06:00.000Z')

function fixture(): ContestScoringFacts {
  return {
    challenges: [
      {
        id: 'challenge-fixed',
        scoringPolicy: { type: 'fixed-v1', points: 200 },
      },
      {
        id: 'challenge-decay',
        scoringPolicy: {
          type: 'decay-v1',
          initial_points: 500,
          minimum_points: 100,
          decay_solves: 10,
        },
      },
    ],
    participations: [
      { id: 'participation-c', teamId: 'team-c', teamName: 'C', divisionId: null, status: 'accepted' },
      { id: 'participation-a', teamId: 'team-a', teamName: 'A', divisionId: null, status: 'accepted' },
      { id: 'participation-d', teamId: 'team-d', teamName: 'D', divisionId: null, status: 'rejected' },
      { id: 'participation-b', teamId: 'team-b', teamName: 'B', divisionId: null, status: 'accepted' },
    ],
    submissions: [
      { id: 'submission-practice', challengeId: 'challenge-decay', participationId: 'participation-c', mode: 'practice', result: 'correct', submittedAt: t4 },
      { id: 'submission-decay-b', challengeId: 'challenge-decay', participationId: 'participation-b', mode: 'official', result: 'correct', submittedAt: t2 },
      { id: 'submission-wrong-c', challengeId: 'challenge-decay', participationId: 'participation-c', mode: 'official', result: 'incorrect', submittedAt: t5 },
      { id: 'submission-fixed-a', challengeId: 'challenge-fixed', participationId: 'participation-a', mode: 'official', result: 'correct', submittedAt: t3 },
      { id: 'submission-decay-a', challengeId: 'challenge-decay', participationId: 'participation-a', mode: 'official', result: 'correct', submittedAt: t1 },
    ],
    solves: [
      { id: 'solve-fixed-a', submissionId: 'submission-fixed-a', challengeId: 'challenge-fixed', participationId: 'participation-a', mode: 'official', solveOrder: 1, solvedAt: t3 },
      { id: 'solve-practice', submissionId: 'submission-practice', challengeId: 'challenge-decay', participationId: 'participation-c', mode: 'practice', solveOrder: 1, solvedAt: t4 },
      { id: 'solve-decay-b', submissionId: 'submission-decay-b', challengeId: 'challenge-decay', participationId: 'participation-b', mode: 'official', solveOrder: 2, solvedAt: t2 },
      { id: 'solve-decay-a', submissionId: 'submission-decay-a', challengeId: 'challenge-decay', participationId: 'participation-a', mode: 'official', solveOrder: 1, solvedAt: t1 },
    ],
    adjustments: [
      { id: 'adjustment-rejected', participationId: 'participation-d', pointsDelta: 1000, createdAt: t6 },
      { id: 'adjustment-b', participationId: 'participation-b', pointsDelta: 10, createdAt: t5 },
      { id: 'adjustment-a', participationId: 'participation-a', pointsDelta: -25, createdAt: t4 },
    ],
  }
}

describe('deterministic contest scoring replay', () => {
  it('rebuilds current challenge values, totals, first solves, and rank summary from facts', () => {
    const replay = replayContestScoring(fixture())
    expect(replay).toEqual({
      schema: 'contest-scoring-replay.v1',
      factVersion: 6,
      challengeScores: [
        {
          challengeId: 'challenge-decay',
          officialSolveCount: 2,
          currentPoints: 461,
          firstSolve: {
            solveId: 'solve-decay-a',
            submissionId: 'submission-decay-a',
            participationId: 'participation-a',
            solvedAt: t1.toISOString(),
          },
        },
        {
          challengeId: 'challenge-fixed',
          officialSolveCount: 1,
          currentPoints: 200,
          firstSolve: {
            solveId: 'solve-fixed-a',
            submissionId: 'submission-fixed-a',
            participationId: 'participation-a',
            solvedAt: t3.toISOString(),
          },
        },
      ],
      participationScores: [
        {
          participationId: 'participation-a', teamId: 'team-a', teamName: 'A',
          divisionId: null, status: 'accepted',
          solves: [
            { solveId: 'solve-decay-a', challengeId: 'challenge-decay', solvedAt: t1.toISOString() },
            { solveId: 'solve-fixed-a', challengeId: 'challenge-fixed', solvedAt: t3.toISOString() },
          ],
          officialSolveCount: 2,
          solvePoints: 661, adjustmentPoints: -25, totalPoints: 636,
          lastScoringAt: t4.toISOString(),
        },
        {
          participationId: 'participation-b', teamId: 'team-b', teamName: 'B',
          divisionId: null, status: 'accepted',
          solves: [
            { solveId: 'solve-decay-b', challengeId: 'challenge-decay', solvedAt: t2.toISOString() },
          ],
          officialSolveCount: 1,
          solvePoints: 461, adjustmentPoints: 10, totalPoints: 471,
          lastScoringAt: t5.toISOString(),
        },
        {
          participationId: 'participation-c', teamId: 'team-c', teamName: 'C',
          divisionId: null, status: 'accepted', solves: [], officialSolveCount: 0,
          solvePoints: 0, adjustmentPoints: 0, totalPoints: 0, lastScoringAt: null,
        },
        {
          participationId: 'participation-d', teamId: 'team-d', teamName: 'D',
          divisionId: null, status: 'rejected', solves: [], officialSolveCount: 0,
          solvePoints: 0, adjustmentPoints: 1000, totalPoints: 1000,
          lastScoringAt: t6.toISOString(),
        },
      ],
      rankingSummary: [
        { rank: 1, participationId: 'participation-a', teamId: 'team-a', totalPoints: 636, lastScoringAt: t4.toISOString() },
        { rank: 2, participationId: 'participation-b', teamId: 'team-b', totalPoints: 471, lastScoringAt: t5.toISOString() },
        { rank: 3, participationId: 'participation-c', teamId: 'team-c', totalPoints: 0, lastScoringAt: null },
      ],
    })
  })

  it('returns byte-for-byte equivalent structures when identical facts arrive in another order', () => {
    const firstFacts = fixture()
    const reordered = fixture()
    reordered.challenges.reverse()
    reordered.participations.reverse()
    reordered.submissions.reverse()
    reordered.solves.reverse()
    reordered.adjustments.reverse()
    const first = replayContestScoring(firstFacts)
    const second = replayContestScoring(reordered)
    expect(second).toEqual(first)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('rejects incomplete or contradictory official facts instead of inventing a score', () => {
    const missingSolve = fixture()
    missingSolve.solves = missingSolve.solves.filter(solve => solve.id !== 'solve-decay-a')
    expect(() => replayContestScoring(missingSolve)).toThrow(ScoringReplayInvariantError)

    const wrongOrder = fixture()
    wrongOrder.solves.find(solve => solve.id === 'solve-decay-b')!.solveOrder = 3
    expect(() => replayContestScoring(wrongOrder)).toThrow(ScoringReplayInvariantError)
  })

  it('loads a contest snapshot once through the replay service', async () => {
    const facts = fixture()
    const repository = { load: vi.fn(async () => facts) }
    const service = new ContestScoringReplayService(repository)
    await expect(service.replay('contest-id')).resolves.toEqual(replayContestScoring(facts))
    expect(repository.load).toHaveBeenCalledOnce()
    expect(repository.load).toHaveBeenCalledWith('contest-id')
  })
})
