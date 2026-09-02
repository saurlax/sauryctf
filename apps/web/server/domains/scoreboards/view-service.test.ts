import { describe, expect, it, vi } from 'vitest'
import type {
  ContestScoringReplay,
  ReplayedParticipationScore,
  ScoringReplayOptions,
} from '../submissions/scoring-replay'
import { ScoreboardBuilder } from './builder'
import {
  ScoreboardViewService,
  type ScoreboardContestState,
  type ScoreboardSnapshotRecord,
  type ScoreboardViewRepository,
} from './view-service'

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
    return this.snapshots.get(snapshotKey(input)) ?? null
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
    const key = snapshotKey(snapshot)
    const existing = this.snapshots.get(key)
    if (existing) return existing
    this.snapshots.set(key, snapshot)
    return snapshot
  }
}

function snapshotKey(input: {
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

const publicInput = {
  contestId,
  view: 'public' as const,
  viewerRole: 'user' as const,
  scope: { type: 'overall' as const },
}

describe('PostgreSQL-backed scoreboard views', () => {
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

    const publicBoard = await service.read(publicInput)
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
    }

    await service.read(publicInput)
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
      ...publicInput,
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
      ...publicInput,
      scope: { type: 'division', divisionId: 'missing' },
    })).rejects.toMatchObject({ code: 'scoreboard.scope_invalid' })

    repository.contest = { ...repository.contest, visibility: 'private' }
    await expect(service.read(publicInput)).rejects.toMatchObject({ code: 'scoreboard.not_found' })
  })

  it('builds a missing current snapshot once and reuses it for repeated reads and restarts', async () => {
    const repository = new FakeRepository()
    const replays = { replay: vi.fn(async () => replay(true)) }
    const service = new ScoreboardViewService(
      repository,
      replays,
      undefined,
      () => new Date('2026-09-01T08:06:00.000Z'),
    )

    const first = await service.read(publicInput)
    const second = await service.read(publicInput)
    expect(first).toEqual(second)
    expect(first).toMatchObject({ version: 2, freshness: 'current', state: 'live' })
    expect(replays.replay).toHaveBeenCalledOnce()

    const restartedReplay = vi.fn(async () => { throw new Error('must not replay') })
    const restarted = new ScoreboardViewService(
      repository,
      { replay: restartedReplay },
      undefined,
      () => new Date('2026-09-01T08:07:00.000Z'),
    )
    await expect(restarted.read(publicInput)).resolves.toEqual(first)
    expect(restartedReplay).not.toHaveBeenCalled()
  })

  it('single-flights concurrent rebuilds in one control-plane process', async () => {
    const repository = new FakeRepository()
    const replays = {
      replay: vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        return replay(true)
      }),
    }
    const service = new ScoreboardViewService(
      repository,
      replays,
      undefined,
      () => new Date('2026-09-01T08:06:00.000Z'),
    )

    const results = await Promise.all(Array.from({ length: 25 }, () => service.read(publicInput)))
    expect(replays.replay).toHaveBeenCalledOnce()
    expect(new Set(results.map(result => result.builtAt))).toHaveLength(1)
    expect(repository.snapshots.has(`${contestId}:public:overall:2`)).toBe(true)
  })

  it('lets independent replicas compute and converge on the unique PostgreSQL snapshot result', async () => {
    const repository = new FakeRepository()
    const replaySource = {
      replay: vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        return replay(true)
      }),
    }
    const first = new ScoreboardViewService(
      repository,
      replaySource,
      undefined,
      () => new Date('2026-09-01T08:06:00.000Z'),
    )
    const second = new ScoreboardViewService(
      repository,
      replaySource,
      undefined,
      () => new Date('2026-09-01T08:06:00.000Z'),
    )

    const results = await Promise.all([first.read(publicInput), second.read(publicInput)])
    expect(replaySource.replay).toHaveBeenCalledTimes(2)
    expect(results[0]).toEqual(results[1])
    expect(repository.snapshots.size).toBe(1)
  })

  it('uses a stale PostgreSQL snapshot if authoritative rebuilding fails', async () => {
    const repository = new FakeRepository()
    repository.snapshots.set(`${contestId}:public:overall:1`, {
      contestId,
      view: 'public',
      scope: { type: 'overall' },
      scopeKey: 'overall',
      version: 1,
      board: new ScoreboardBuilder().build(replay(false), { type: 'overall' }),
      builtAt: new Date('2026-09-01T08:05:00.000Z'),
    })
    const service = new ScoreboardViewService(
      repository,
      { replay: vi.fn(async () => { throw new Error('database overloaded') }) },
      undefined,
      () => new Date('2026-09-01T08:06:00.000Z'),
    )

    await expect(service.read(publicInput))
      .resolves.toMatchObject({ version: 1, freshness: 'stale' })
  })
})
