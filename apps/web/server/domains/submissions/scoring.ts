import {
  challengeScoringPolicySchema,
  type ChallengeScoringPolicy,
} from '../../../shared/contracts/challenges'

export class ChallengeScoringInputError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'ChallengeScoringInputError'
  }
}

/**
 * Returns the current value of a challenge for one authoritative count of
 * official solves. Historical solve awards are audit data; a dynamic
 * scoreboard must apply this current value to every official solver.
 */
export function calculateChallengeScore(
  policy: ChallengeScoringPolicy,
  officialSolveCount: number,
): number {
  const parsed = challengeScoringPolicySchema.safeParse(policy)
  if (!parsed.success) {
    throw new ChallengeScoringInputError('Invalid challenge scoring policy')
  }
  if (!Number.isSafeInteger(officialSolveCount) || officialSolveCount < 0) {
    throw new ChallengeScoringInputError('Official solve count must be a non-negative safe integer')
  }

  if (parsed.data.type === 'fixed-v1') return parsed.data.points

  const { initial_points: initial, minimum_points: minimum, decay_solves: decay } = parsed.data
  if (officialSolveCount <= 1 || initial === minimum) return initial

  const decayed = minimum + (initial - minimum) * Math.exp((1 - officialSolveCount) / decay)
  return Math.max(minimum, Math.min(initial, Math.floor(decayed)))
}
