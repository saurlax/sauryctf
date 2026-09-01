import type { ChallengeScoringPolicy } from '../../../shared/contracts/challenges'
import { calculateChallengeScore } from './scoring'

export type ReplaySubmissionMode = 'official' | 'practice'
export type ReplaySubmissionResult =
  | 'incorrect'
  | 'correct'
  | 'already_solved'
  | 'rate_limited'
  | 'ineligible'
export type ReplayParticipationStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn'

export interface ReplayChallengeFact {
  id: string
  scoringPolicy: ChallengeScoringPolicy
}

export interface ReplayParticipationFact {
  id: string
  teamId: string
  teamName: string
  divisionId: string | null
  status: ReplayParticipationStatus
}

export interface ReplaySubmissionFact {
  id: string
  challengeId: string
  participationId: string
  mode: ReplaySubmissionMode
  result: ReplaySubmissionResult
  submittedAt: Date
}

export interface ReplaySolveFact {
  id: string
  submissionId: string
  challengeId: string
  participationId: string
  mode: ReplaySubmissionMode
  solveOrder: number
  solvedAt: Date
}

export interface ReplayScoreAdjustmentFact {
  id: string
  participationId: string
  pointsDelta: number
  createdAt: Date
}

export interface ContestScoringFacts {
  challenges: ReplayChallengeFact[]
  participations: ReplayParticipationFact[]
  submissions: ReplaySubmissionFact[]
  solves: ReplaySolveFact[]
  adjustments: ReplayScoreAdjustmentFact[]
}

export interface ScoringReplayRepository {
  load(contestId: string): Promise<ContestScoringFacts>
}

export interface ReplayedChallengeScore {
  challengeId: string
  officialSolveCount: number
  currentPoints: number
  firstSolve: {
    solveId: string
    submissionId: string
    participationId: string
    solvedAt: string
  } | null
}

export interface ReplayedParticipationScore {
  participationId: string
  teamId: string
  teamName: string
  divisionId: string | null
  status: ReplayParticipationStatus
  officialSolveCount: number
  solvePoints: number
  adjustmentPoints: number
  totalPoints: number
  lastScoringAt: string | null
}

export interface ReplayedRankSummary {
  rank: number
  participationId: string
  teamId: string
  totalPoints: number
  lastScoringAt: string | null
}

export interface ContestScoringReplay {
  schema: 'contest-scoring-replay.v1'
  challengeScores: ReplayedChallengeScore[]
  participationScores: ReplayedParticipationScore[]
  rankingSummary: ReplayedRankSummary[]
}

export class ScoringReplayContestNotFoundError extends Error {}

export class ScoringReplayInvariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScoringReplayInvariantError'
  }
}

export class ContestScoringReplayService {
  constructor(private readonly repository: ScoringReplayRepository) {}

  async replay(contestId: string): Promise<ContestScoringReplay> {
    return replayContestScoring(await this.repository.load(contestId))
  }
}

export function replayContestScoring(facts: ContestScoringFacts): ContestScoringReplay {
  const challenges = uniqueById(facts.challenges, 'challenge')
  const participations = uniqueById(facts.participations, 'participation')
  const submissions = uniqueById(facts.submissions, 'submission')
  uniqueById(facts.solves, 'solve')
  uniqueById(facts.adjustments, 'score adjustment')

  const officialSolves = facts.solves
    .filter(solve => solve.mode === 'official')
    .toSorted(compareSolveFacts)
  const solvesByChallenge = new Map<string, ReplaySolveFact[]>()
  const solvedPairs = new Set<string>()
  const solvedSubmissionIds = new Set<string>()
  for (const solve of officialSolves) {
    const challenge = challenges.get(solve.challengeId)
    const participation = participations.get(solve.participationId)
    const submission = submissions.get(solve.submissionId)
    if (!challenge) throw invariant(`Solve ${solve.id} references an unknown challenge`)
    if (!participation) throw invariant(`Solve ${solve.id} references an unknown participation`)
    if (!submission
      || submission.mode !== 'official'
      || submission.result !== 'correct'
      || submission.challengeId !== solve.challengeId
      || submission.participationId !== solve.participationId
      || submission.submittedAt.getTime() !== solve.solvedAt.getTime()) {
      throw invariant(`Solve ${solve.id} does not match one correct official submission`)
    }
    if (!Number.isSafeInteger(solve.solveOrder) || solve.solveOrder <= 0) {
      throw invariant(`Solve ${solve.id} has an invalid solve order`)
    }
    requireValidDate(solve.solvedAt, `Solve ${solve.id}`)
    const pair = `${solve.participationId}\0${solve.challengeId}`
    if (solvedPairs.has(pair)) throw invariant(`Duplicate official solve pair for ${pair}`)
    if (solvedSubmissionIds.has(solve.submissionId)) {
      throw invariant(`Duplicate official solve submission ${solve.submissionId}`)
    }
    solvedPairs.add(pair)
    solvedSubmissionIds.add(solve.submissionId)
    const challengeSolves = solvesByChallenge.get(solve.challengeId) ?? []
    challengeSolves.push(solve)
    solvesByChallenge.set(solve.challengeId, challengeSolves)
  }
  for (const submission of facts.submissions) {
    requireValidDate(submission.submittedAt, `Submission ${submission.id}`)
    if (!challenges.has(submission.challengeId)) {
      throw invariant(`Submission ${submission.id} references an unknown challenge`)
    }
    if (!participations.has(submission.participationId)) {
      throw invariant(`Submission ${submission.id} references an unknown participation`)
    }
    if (submission.mode === 'official'
      && submission.result === 'correct'
      && !solvedSubmissionIds.has(submission.id)) {
      throw invariant(`Correct official submission ${submission.id} has no solve fact`)
    }
  }

  const challengeScores: ReplayedChallengeScore[] = []
  const challengePoints = new Map<string, number>()
  for (const challenge of [...challenges.values()].toSorted((a, b) => a.id.localeCompare(b.id))) {
    const solves = (solvesByChallenge.get(challenge.id) ?? []).toSorted(compareSolveFacts)
    for (const [index, solve] of solves.entries()) {
      if (solve.solveOrder !== index + 1) {
        throw invariant(`Challenge ${challenge.id} has a non-contiguous official solve order`)
      }
    }
    const currentPoints = calculateChallengeScore(challenge.scoringPolicy, solves.length)
    challengePoints.set(challenge.id, currentPoints)
    const first = solves[0]
    challengeScores.push({
      challengeId: challenge.id,
      officialSolveCount: solves.length,
      currentPoints,
      firstSolve: first
        ? {
            solveId: first.id,
            submissionId: first.submissionId,
            participationId: first.participationId,
            solvedAt: first.solvedAt.toISOString(),
          }
        : null,
    })
  }

  const participationAccumulators = new Map(
    [...participations.values()].map(participation => [participation.id, {
      participation,
      officialSolveCount: 0,
      solvePoints: 0,
      adjustmentPoints: 0,
      lastScoringAt: null as Date | null,
    }]),
  )
  for (const solve of officialSolves) {
    const accumulator = participationAccumulators.get(solve.participationId)!
    accumulator.officialSolveCount += 1
    accumulator.solvePoints = safeAdd(
      accumulator.solvePoints,
      challengePoints.get(solve.challengeId)!,
      'solve points',
    )
    accumulator.lastScoringAt = laterDate(accumulator.lastScoringAt, solve.solvedAt)
  }
  for (const adjustment of facts.adjustments.toSorted(compareAdjustmentFacts)) {
    const accumulator = participationAccumulators.get(adjustment.participationId)
    if (!accumulator) {
      throw invariant(`Score adjustment ${adjustment.id} references an unknown participation`)
    }
    if (!Number.isSafeInteger(adjustment.pointsDelta) || adjustment.pointsDelta === 0) {
      throw invariant(`Score adjustment ${adjustment.id} has an invalid points delta`)
    }
    requireValidDate(adjustment.createdAt, `Score adjustment ${adjustment.id}`)
    accumulator.adjustmentPoints = safeAdd(
      accumulator.adjustmentPoints,
      adjustment.pointsDelta,
      'adjustment points',
    )
    accumulator.lastScoringAt = laterDate(accumulator.lastScoringAt, adjustment.createdAt)
  }

  const participationScores = [...participationAccumulators.values()]
    .map<ReplayedParticipationScore>((accumulator) => {
      const totalPoints = safeAdd(
        accumulator.solvePoints,
        accumulator.adjustmentPoints,
        'total points',
      )
      return {
        participationId: accumulator.participation.id,
        teamId: accumulator.participation.teamId,
        teamName: accumulator.participation.teamName,
        divisionId: accumulator.participation.divisionId,
        status: accumulator.participation.status,
        officialSolveCount: accumulator.officialSolveCount,
        solvePoints: accumulator.solvePoints,
        adjustmentPoints: accumulator.adjustmentPoints,
        totalPoints,
        lastScoringAt: accumulator.lastScoringAt?.toISOString() ?? null,
      }
    })
    .toSorted((a, b) => a.participationId.localeCompare(b.participationId))

  const rankingSummary = participationScores
    .filter(score => score.status === 'accepted')
    .toSorted(compareParticipationScores)
    .map<ReplayedRankSummary>((score, index) => ({
      rank: index + 1,
      participationId: score.participationId,
      teamId: score.teamId,
      totalPoints: score.totalPoints,
      lastScoringAt: score.lastScoringAt,
    }))

  return {
    schema: 'contest-scoring-replay.v1',
    challengeScores,
    participationScores,
    rankingSummary,
  }
}

function uniqueById<T extends { id: string }>(facts: T[], kind: string) {
  const result = new Map<string, T>()
  for (const fact of facts) {
    if (result.has(fact.id)) throw invariant(`Duplicate ${kind} id ${fact.id}`)
    result.set(fact.id, fact)
  }
  return result
}

function compareSolveFacts(a: ReplaySolveFact, b: ReplaySolveFact) {
  return a.challengeId.localeCompare(b.challengeId)
    || a.solveOrder - b.solveOrder
    || a.solvedAt.getTime() - b.solvedAt.getTime()
    || a.id.localeCompare(b.id)
}

function compareAdjustmentFacts(a: ReplayScoreAdjustmentFact, b: ReplayScoreAdjustmentFact) {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
}

function compareParticipationScores(a: ReplayedParticipationScore, b: ReplayedParticipationScore) {
  if (a.totalPoints !== b.totalPoints) return a.totalPoints > b.totalPoints ? -1 : 1
  const aLastScoringAt = nullableTimestamp(a.lastScoringAt)
  const bLastScoringAt = nullableTimestamp(b.lastScoringAt)
  if (aLastScoringAt !== bLastScoringAt) return aLastScoringAt < bLastScoringAt ? -1 : 1
  return a.participationId.localeCompare(b.participationId)
}

function nullableTimestamp(value: string | null) {
  return value === null ? Number.POSITIVE_INFINITY : Date.parse(value)
}

function laterDate(current: Date | null, candidate: Date) {
  requireValidDate(candidate, 'Scoring fact')
  return current === null || candidate.getTime() > current.getTime() ? candidate : current
}

function safeAdd(left: number, right: number, label: string) {
  const result = left + right
  if (!Number.isSafeInteger(result)) throw invariant(`Replayed ${label} exceeded the safe integer range`)
  return result
}

function requireValidDate(value: Date, label: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw invariant(`${label} has an invalid timestamp`)
  }
}

function invariant(message: string) {
  return new ScoringReplayInvariantError(message)
}
