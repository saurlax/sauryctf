import { describe, expect, it } from 'vitest'
import type { ChallengeScoringPolicy } from '../../../shared/contracts/challenges'
import {
  calculateChallengeScore,
  ChallengeScoringInputError,
} from './scoring'

describe('deterministic challenge scoring', () => {
  it('keeps fixed-v1 unchanged for every official solve count', () => {
    const policy = { type: 'fixed-v1', points: 500 } as const
    expect([0, 1, 2, 1_000_000].map(count => calculateChallengeScore(policy, count)))
      .toEqual([500, 500, 500, 500])
  })

  it('matches the decay-v1 fixed fixture and floor boundary', () => {
    const policy = {
      type: 'decay-v1',
      initial_points: 500,
      minimum_points: 100,
      decay_solves: 10,
    } as const
    const fixture = [
      [0, 500],
      [1, 500],
      [2, 461],
      [5, 368],
      [10, 262],
      [11, 247],
      [100, 100],
      [1_000_000, 100],
    ] as const

    for (const [solveCount, expected] of fixture) {
      expect(calculateChallengeScore(policy, solveCount)).toBe(expected)
    }
  })

  it('handles a zero minimum and an equal minimum without escaping policy bounds', () => {
    expect(calculateChallengeScore({
      type: 'decay-v1',
      initial_points: 1,
      minimum_points: 0,
      decay_solves: 1,
    }, 1_000_000)).toBe(0)
    expect(calculateChallengeScore({
      type: 'decay-v1',
      initial_points: 250,
      minimum_points: 250,
      decay_solves: 5,
    }, 1_000_000)).toBe(250)
  })

  it('replays identical fixtures to the identical value', () => {
    const policy = {
      type: 'decay-v1',
      initial_points: 1_000,
      minimum_points: 200,
      decay_solves: 25,
    } as const
    const firstReplay = Array.from({ length: 200 }, (_, count) => calculateChallengeScore(policy, count))
    const secondReplay = Array.from({ length: 200 }, (_, count) => calculateChallengeScore(policy, count))
    expect(secondReplay).toEqual(firstReplay)
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid official solve count: %s',
    (solveCount) => {
      expect(() => calculateChallengeScore({ type: 'fixed-v1', points: 500 }, solveCount))
        .toThrow(ChallengeScoringInputError)
    },
  )

  it('rejects an invalid policy even when TypeScript input validation is bypassed', () => {
    const invalid = {
      type: 'decay-v1',
      initial_points: 100,
      minimum_points: 200,
      decay_solves: 0,
    } as unknown as ChallengeScoringPolicy
    expect(() => calculateChallengeScore(invalid, 1)).toThrow(ChallengeScoringInputError)
  })
})
