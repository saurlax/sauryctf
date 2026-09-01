import { z } from 'zod'
import type { ScoreboardProjection, ScoreboardProjectionState, ScoreboardView } from './view-service'

export const scoreboardProjectionCacheSchema = 'scoreboard-cache.v1' as const

export interface ScoreboardCacheDescriptor {
  contestId: string
  view: ScoreboardView
  scopeKey: string
  version: number
  state: ScoreboardProjectionState
  frozenAt: string | null
}

export interface ScoreboardProjectionCache {
  get(descriptor: ScoreboardCacheDescriptor): Promise<ScoreboardProjection | null>
  set(projection: ScoreboardProjection): Promise<void>
}

const stableId = z.string().min(1).max(128)
const safeInteger = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
const nonnegativeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const timestamp = z.iso.datetime({ offset: false, precision: 3 })
const scope = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('overall') }),
  z.strictObject({ type: z.literal('division'), divisionId: stableId }),
])
const board = z.strictObject({
  schema: z.literal('scoreboard.v1'),
  scope,
  scopeKey: stableId,
  challenges: z.array(z.strictObject({
    challengeId: stableId,
    officialSolveCount: nonnegativeInteger,
    currentPoints: nonnegativeInteger,
    firstSolveParticipationId: stableId.nullable(),
  })),
  rows: z.array(z.strictObject({
    rank: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    participationId: stableId,
    teamId: stableId,
    teamName: z.string().min(1).max(128),
    divisionId: stableId.nullable(),
    totalPoints: safeInteger,
    solvePoints: safeInteger,
    adjustmentPoints: safeInteger,
    officialSolveCount: nonnegativeInteger,
    lastScoringAt: timestamp.nullable(),
    solves: z.array(z.strictObject({
      solveId: stableId,
      challengeId: stableId,
      solvedAt: timestamp,
    })),
  })),
})
const projection = z.strictObject({
  schema: z.literal('scoreboard-projection.v1'),
  contestId: stableId,
  view: z.literal('public'),
  state: z.enum(['live', 'frozen', 'settled']),
  freshness: z.enum(['current', 'stale']),
  version: nonnegativeInteger,
  frozenAt: timestamp.nullable(),
  builtAt: timestamp,
  board,
})
const cacheEnvelope = z.strictObject({
  cacheSchema: z.literal(scoreboardProjectionCacheSchema),
  projection,
})

export function scoreboardCacheKey(descriptor: ScoreboardCacheDescriptor): string {
  return [
    'sauryctf',
    'scoreboard',
    scoreboardProjectionCacheSchema,
    `contest=${encodeURIComponent(descriptor.contestId)}`,
    `view=${descriptor.view}`,
    `scope=${encodeURIComponent(descriptor.scopeKey)}`,
    `version=${descriptor.version}`,
  ].join(':')
}

export function scoreboardBuildKey(descriptor: ScoreboardCacheDescriptor): string {
  return [
    scoreboardCacheKey(descriptor),
    `state=${descriptor.state}`,
    `frozen-at=${encodeURIComponent(descriptor.frozenAt ?? 'none')}`,
  ].join(':')
}

export function serializeScoreboardCacheValue(value: ScoreboardProjection): string {
  if (value.freshness !== 'current') throw new TypeError('Stale scoreboards must not enter Redis')
  return JSON.stringify(cacheEnvelope.parse({
    cacheSchema: scoreboardProjectionCacheSchema,
    projection: value,
  }))
}

export function parseScoreboardCacheValue(
  descriptor: ScoreboardCacheDescriptor,
  serialized: string,
): ScoreboardProjection | null {
  let raw: unknown
  try {
    raw = JSON.parse(serialized)
  }
  catch {
    return null
  }
  const parsed = cacheEnvelope.safeParse(raw)
  if (!parsed.success) return null
  const value = parsed.data.projection
  if (value.contestId !== descriptor.contestId
    || value.view !== descriptor.view
    || value.board.scopeKey !== descriptor.scopeKey
    || value.version !== descriptor.version
    || value.state !== descriptor.state
    || value.frozenAt !== descriptor.frozenAt) {
    return null
  }
  return value
}

export function cacheDescriptor(projection: ScoreboardProjection): ScoreboardCacheDescriptor {
  return {
    contestId: projection.contestId,
    view: projection.view,
    scopeKey: projection.board.scopeKey,
    version: projection.version,
    state: projection.state,
    frozenAt: projection.frozenAt,
  }
}
