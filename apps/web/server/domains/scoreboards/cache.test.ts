import { describe, expect, it } from 'vitest'
import {
  cacheDescriptor,
  parseScoreboardCacheValue,
  scoreboardCacheKey,
  scoreboardProjectionCacheSchema,
  serializeScoreboardCacheValue,
  type ScoreboardCacheDescriptor,
} from './cache'
import type { ScoreboardProjection } from './view-service'

function projection(overrides: Partial<ScoreboardProjection> = {}): ScoreboardProjection {
  return {
    schema: 'scoreboard-projection.v1',
    contestId: 'contest/one',
    view: 'public',
    state: 'frozen',
    version: 7,
    frozenAt: '2026-09-01T08:10:00.000Z',
    builtAt: '2026-09-01T08:10:01.000Z',
    board: {
      schema: 'scoreboard.v1',
      scope: { type: 'division', divisionId: 'division:blue' },
      scopeKey: 'division:blue',
      challenges: [{
        challengeId: 'challenge-1',
        officialSolveCount: 1,
        currentPoints: 500,
        firstSolveParticipationId: 'participation-1',
      }],
      rows: [{
        rank: 1,
        participationId: 'participation-1',
        teamId: 'team-1',
        teamName: 'Team One',
        divisionId: 'division:blue',
        totalPoints: 500,
        solvePoints: 500,
        adjustmentPoints: 0,
        officialSolveCount: 1,
        lastScoringAt: '2026-09-01T08:05:00.000Z',
        solves: [{
          solveId: 'solve-1',
          challengeId: 'challenge-1',
          solvedAt: '2026-09-01T08:05:00.000Z',
        }],
      }],
    },
    ...overrides,
  }
}

describe('scoreboard projection cache contract', () => {
  it('keys entries by schema, contest, view, scope, and authoritative version', () => {
    const descriptor = cacheDescriptor(projection())
    expect(scoreboardCacheKey(descriptor)).toBe(
      `sauryctf:scoreboard:${scoreboardProjectionCacheSchema}:contest=contest%2Fone:view=public:scope=division%3Ablue:version=7`,
    )
  })

  it('accepts only an envelope matching every descriptor dimension and state', () => {
    const value = projection()
    const serialized = serializeScoreboardCacheValue(value)
    const descriptor = cacheDescriptor(value)
    expect(parseScoreboardCacheValue(descriptor, serialized)).toEqual(value)

    const mismatches: ScoreboardCacheDescriptor[] = [
      { ...descriptor, contestId: 'contest-two' },
      { ...descriptor, view: 'internal' },
      { ...descriptor, scopeKey: 'overall' },
      { ...descriptor, version: 6 },
      { ...descriptor, state: 'live' },
      { ...descriptor, frozenAt: '2026-09-01T08:11:00.000Z' },
    ]
    for (const mismatch of mismatches) {
      expect(parseScoreboardCacheValue(mismatch, serialized)).toBeNull()
    }
  })

  it('rejects malformed, unknown-schema, and structurally incomplete values', () => {
    const descriptor = cacheDescriptor(projection())
    expect(parseScoreboardCacheValue(descriptor, '{')).toBeNull()
    expect(parseScoreboardCacheValue(descriptor, JSON.stringify({
      cacheSchema: 'scoreboard-cache.v0',
      projection: projection(),
    }))).toBeNull()
    expect(parseScoreboardCacheValue(descriptor, JSON.stringify({
      cacheSchema: scoreboardProjectionCacheSchema,
      projection: { ...projection(), board: { schema: 'scoreboard.v1' } },
    }))).toBeNull()
  })

  it('refuses to serialize internal privileged projections', () => {
    expect(() => serializeScoreboardCacheValue(projection({ view: 'internal' }))).toThrow()
  })
})
