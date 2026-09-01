import { describe, expect, it, vi } from 'vitest'
import type {
  ContestScoringReplay,
  ReplayedParticipationScore,
  ScoringReplayOptions,
} from '../submissions/scoring-replay'
import {
  ScoreboardViewService,
  type ScoreboardProjection,
  type ScoreboardContestState,
  type ScoreboardSnapshotRecord,
  type ScoreboardViewRepository,
} from './view-service'
import {
  cacheDescriptor,
  parseScoreboardCacheValue,
  scoreboardCacheKey,
  serializeScoreboardCacheValue,
  type ScoreboardProjectionCache,
} from './cache'

const contestId = 'contest-1'
const freezeAt = new Date('2026-09-01T08:10:00.000Z')
const endAt = new Date('2026-09-01T08:20:00.000Z')
const duringFreeze = new Date('2026-09-01T08:15:00.000Z')
const afterEnd = new Date('2026-09-01T08:21:00.000Z')

class FakeRepository implements ScoreboardViewRepository {
  contest: ScoreboardContestState = {
    contestId,
    publicationStatus: 'published',
    visibility: 'public',
    freezeAt,
    endAt,
    currentVersion: 2,
  }

  snapshots = new Map<string, ScoreboardSnapshotRecord>()

  async readContestState() {
    return this.contest
  }

  async divisionExists(_contestId: string, divisionId: string) {
    return divisionId === 'division-1'
  }

  async readSnapshot(input: {
    contestId: string
    view: 'public' | 'internal'
    scopeKey: string
    version: number
  }) {
    return this.snapshots.get(key(input)) ?? null
  }

  async readLatestSnapshot(input: {
    contestId: string
    view: 'public' | 'internal'
    scopeKey: string
  }) {
    return [...this.snapshots.values()]
      .filter(snapshot => snapshot.contestId === input.contestId
        && snapshot.view === input.view
        && snapshot.scopeKey === input.scopeKey)
      .toSorted((a, b) => b.version - a.version)[0] ?? null
  }

  async readLatestSnapshotVersion(input: {
    contestId: string
    view: 'public' | 'internal'
    scopeKey: string
  }) {
    return (await this.readLatestSnapshot(input))?.version ?? null
  }

  async writeSnapshot(snapshot: ScoreboardSnapshotRecord) {
    const snapshotKey = key(snapshot)
    const existing = this.snapshots.get(snapshotKey)
    if (existing) return existing
    this.snapshots.set(snapshotKey, snapshot)
    return snapshot
  }
}

function key(input: {
  contestId: string
  view: string
  scopeKey: string
  version: number
}) {
  return `${input.contestId}:${input.view}:${input.scopeKey}:${input.version}`
}

function participant(input: {
  id: string
  teamId: string
  points: number
  solved: boolean
}): ReplayedParticipationScore {
  const solvedAt = '2026-09-01T08:05:00.000Z'
  return {
    participationId: input.id,
    teamId: input.teamId,
    teamName: input.teamId,
    divisionId: 'division-1',
    status: 'accepted',
    solves: input.solved
      ? [{ solveId: `solve-${input.id}`, challengeId: 'challenge-1', solvedAt }]
      : [],
    officialSolveCount: input.solved ? 1 : 0,
    solvePoints: input.points,
    adjustmentPoints: 0,
    totalPoints: input.points,
    lastScoringAt: input.solved ? solvedAt : null,
  }
}

function replay(includePostFreezeSolve: boolean): ContestScoringReplay {
  return {
    schema: 'contest-scoring-replay.v1',
    factVersion: includePostFreezeSolve ? 2 : 1,
    challengeScores: [{
      challengeId: 'challenge-1',
      officialSolveCount: includePostFreezeSolve ? 2 : 1,
      currentPoints: 500,
      firstSolve: {
        solveId: 'solve-participation-a',
        submissionId: 'submission-a',
        participationId: 'participation-a',
        solvedAt: '2026-09-01T08:05:00.000Z',
      },
    }],
    participationScores: [
      participant({ id: 'participation-a', teamId: 'team-a', points: 500, solved: true }),
      participant({
        id: 'participation-b',
        teamId: 'team-b',
        points: includePostFreezeSolve ? 500 : 0,
        solved: includePostFreezeSolve,
      }),
    ],
    rankingSummary: [],
  }
}

class FakeCache implements ScoreboardProjectionCache {
  values = new Map<string, string>()
  get = vi.fn(async (descriptor: ReturnType<typeof cacheDescriptor>) => {
    const serialized = this.values.get(scoreboardCacheKey(descriptor))
    return serialized ? parseScoreboardCacheValue(descriptor, serialized) : null
  })

  set = vi.fn(async (value: ScoreboardProjection) => {
    this.values.set(scoreboardCacheKey(cacheDescriptor(value)), serializeScoreboardCacheValue(value))
  })

  seed(value: ScoreboardProjection) {
    this.values.set(scoreboardCacheKey(cacheDescriptor(value)), serializeScoreboardCacheValue(value))
  }
}

describe('role-aware scoreboard freeze views', () => {
  it('keeps the public board frozen while organizer and admin views remain live', async () => {
    const repository = new FakeRepository()
    const replaySource = {
      replay: vi.fn(async (_contestId: string, options?: ScoringReplayOptions) => (
        replay(options?.factsBefore === undefined)
      )),
    }
    const service = new ScoreboardViewService(
      repository,
      replaySource,
      undefined,
      () => duringFreeze,
    )

    const publicBoard = await service.read({
      contestId,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'overall' },
    })
    expect(publicBoard).toMatchObject({ view: 'public', state: 'frozen', version: 1 })
    expect(publicBoard.frozenAt).toBe(freezeAt.toISOString())
    expect(publicBoard.board.rows.map(row => [row.teamId, row.totalPoints])).toEqual([
      ['team-a', 500],
      ['team-b', 0],
    ])
    expect(replaySource.replay).toHaveBeenCalledWith(contestId, { factsBefore: freezeAt })

    for (const viewerRole of ['organizer', 'admin'] as const) {
      const internal = await service.read({
        contestId,
        view: 'internal',
        viewerRole,
        scope: { type: 'overall' },
      })
      expect(internal).toMatchObject({ view: 'internal', state: 'live', version: 2 })
      expect(internal.board.rows.map(row => [row.teamId, row.totalPoints])).toEqual([
        ['team-a', 500],
        ['team-b', 500],
      ])
    }

    await service.read({
      contestId,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'overall' },
    })
    expect(replaySource.replay.mock.calls.filter(call => call[1]?.factsBefore)).toHaveLength(1)
  })

  it('settles the public board to the final version after the contest ends', async () => {
    const repository = new FakeRepository()
    const replaySource = { replay: vi.fn(async () => replay(true)) }
    const service = new ScoreboardViewService(
      repository,
      replaySource,
      undefined,
      () => afterEnd,
    )
    const result = await service.read({
      contestId,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'division', divisionId: 'division-1' },
    })
    expect(result).toMatchObject({ state: 'settled', version: 2, frozenAt: null })
    expect(result.board.rows).toHaveLength(2)
    expect(repository.snapshots.has(`${contestId}:public:division-1:2`)).toBe(true)
  })

  it('rejects internal reads by users and invalid or non-public scopes', async () => {
    const repository = new FakeRepository()
    const service = new ScoreboardViewService(
      repository,
      { replay: async () => replay(true) },
      undefined,
      () => duringFreeze,
    )
    await expect(service.read({
      contestId,
      view: 'internal',
      viewerRole: 'user',
      scope: { type: 'division', divisionId: 'missing' },
    })).rejects.toMatchObject({ code: 'scoreboard.internal_forbidden' })
    await expect(service.read({
      contestId,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'division', divisionId: 'missing' },
    })).rejects.toMatchObject({ code: 'scoreboard.scope_invalid' })

    repository.contest = { ...repository.contest, visibility: 'private' }
    await expect(service.read({
      contestId,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'division', divisionId: 'missing' },
    })).rejects.toMatchObject({ code: 'scoreboard.not_found' })
  })

  it('uses only the current authoritative version and rejects a stale cached projection', async () => {
    const repository = new FakeRepository()
    const replays = { replay: vi.fn(async () => replay(true)) }
    const cache = new FakeCache()
    repository.contest = { ...repository.contest, currentVersion: 1 }
    const staleService = new ScoreboardViewService(
      repository,
      { replay: async () => replay(false) },
      undefined,
      () => new Date('2026-09-01T08:06:00.000Z'),
    )
    cache.seed(await staleService.read({
      contestId,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'overall' },
    }))
    repository.contest = { ...repository.contest, currentVersion: 2 }
    const service = new ScoreboardViewService(
      repository,
      replays,
      undefined,
      () => new Date('2026-09-01T08:06:00.000Z'),
      cache,
    )

    const result = await service.read({
      contestId,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'overall' },
    })
    expect(result.version).toBe(2)
    expect(replays.replay).toHaveBeenCalledOnce()
    expect(cache.get).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }))

    replays.replay.mockClear()
    expect((await service.read({
      contestId,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'overall' },
    })).version).toBe(2)
    expect(replays.replay).not.toHaveBeenCalled()
  })

  it('never consults public projection caches for forbidden or authorized internal reads', async () => {
    const repository = new FakeRepository()
    const cache = new FakeCache()
    const replays = { replay: vi.fn(async () => replay(true)) }
    const service = new ScoreboardViewService(
      repository,
      replays,
      undefined,
      () => duringFreeze,
      cache,
    )

    await expect(service.read({
      contestId,
      view: 'internal',
      viewerRole: 'user',
      scope: { type: 'overall' },
    })).rejects.toMatchObject({ code: 'scoreboard.internal_forbidden' })
    await service.read({
      contestId,
      view: 'internal',
      viewerRole: 'organizer',
      scope: { type: 'overall' },
    })
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('rejects a live cache entry after the same version becomes settled', async () => {
    const repository = new FakeRepository()
    const cache = new FakeCache()
    const liveService = new ScoreboardViewService(
      repository,
      { replay: async () => replay(true) },
      undefined,
      () => new Date('2026-09-01T08:06:00.000Z'),
    )
    cache.seed(await liveService.read({
      contestId,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'overall' },
    }))
    const replays = { replay: vi.fn(async () => replay(true)) }
    const settledService = new ScoreboardViewService(
      repository,
      replays,
      undefined,
      () => afterEnd,
      cache,
    )

    const result = await settledService.read({
      contestId,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'overall' },
    })
    expect(result.state).toBe('settled')
    expect(replays.replay).toHaveBeenCalledOnce()
  })

  it('falls back to authoritative materialization when cache operations fail', async () => {
    const repository = new FakeRepository()
    const replays = { replay: vi.fn(async () => replay(true)) }
    const failingCache: ScoreboardProjectionCache = {
      get: vi.fn(async () => { throw new Error('redis unavailable') }),
      set: vi.fn(async () => { throw new Error('redis unavailable') }),
    }
    const service = new ScoreboardViewService(
      repository,
      replays,
      undefined,
      () => new Date('2026-09-01T08:06:00.000Z'),
      failingCache,
    )
    await expect(service.read({
      contestId,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'overall' },
    })).resolves.toMatchObject({ version: 2, state: 'live' })
    expect(replays.replay).toHaveBeenCalledOnce()
  })
})
