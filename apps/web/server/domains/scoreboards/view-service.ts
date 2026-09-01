import type { ContestScoringReplay, ScoringReplayOptions } from '../submissions/scoring-replay'
import {
  ScoreboardBuilder,
  type ScoreboardReadModel,
  type ScoreboardScope,
} from './builder'
import {
  scoreboardBuildKey,
  type ScoreboardCacheDescriptor,
  type ScoreboardProjectionCache,
} from './cache'
import {
  ScoreboardBuildCoordinator,
  type ScoreboardBuildMode,
} from './build-coordinator'

export type ScoreboardView = 'public' | 'internal'
export type ScoreboardViewerRole = 'user' | 'organizer' | 'admin'
export type ScoreboardProjectionState = 'live' | 'frozen' | 'settled'

export interface ScoreboardContestState {
  contestId: string
  publicationStatus: 'draft' | 'published' | 'archived'
  visibility: 'public' | 'private'
  freezeAt: Date | null
  endAt: Date
  currentVersion: number
}

export interface ScoreboardSnapshotRecord {
  contestId: string
  view: ScoreboardView
  scope: ScoreboardScope
  scopeKey: string
  version: number
  board: ScoreboardReadModel
  builtAt: Date
}

export interface ScoreboardViewRepository {
  readContestState(contestId: string): Promise<ScoreboardContestState>
  divisionExists(contestId: string, divisionId: string): Promise<boolean>
  readLatestSnapshot(input: {
    contestId: string
    view: ScoreboardView
    scopeKey: string
  }): Promise<ScoreboardSnapshotRecord | null>
  readLatestSnapshotVersion(input: {
    contestId: string
    view: ScoreboardView
    scopeKey: string
  }): Promise<number | null>
  readSnapshot(input: {
    contestId: string
    view: ScoreboardView
    scopeKey: string
    version: number
  }): Promise<ScoreboardSnapshotRecord | null>
  writeSnapshot(snapshot: ScoreboardSnapshotRecord): Promise<ScoreboardSnapshotRecord>
}

export interface ScoreboardReplaySource {
  replay(contestId: string, options?: ScoringReplayOptions): Promise<ContestScoringReplay>
}

export class ScoreboardContestNotFoundError extends Error {}
export class ScoreboardSnapshotConflictError extends Error {}

export interface ReadScoreboardInput {
  contestId: string
  view: ScoreboardView
  viewerRole: ScoreboardViewerRole
  scope: ScoreboardScope
}

export interface ScoreboardProjection {
  schema: 'scoreboard-projection.v1'
  contestId: string
  view: ScoreboardView
  state: ScoreboardProjectionState
  freshness: 'current' | 'stale'
  version: number
  frozenAt: string | null
  builtAt: string
  board: ScoreboardReadModel
}

export type ScoreboardViewErrorCode =
  | 'scoreboard.not_found'
  | 'scoreboard.internal_forbidden'
  | 'scoreboard.scope_invalid'
  | 'scoreboard.time_invalid'

export class ScoreboardViewServiceError extends Error {
  constructor(
    readonly code: ScoreboardViewErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ScoreboardViewServiceError'
  }
}

export class ScoreboardViewService {
  constructor(
    private readonly repository: ScoreboardViewRepository,
    private readonly replays: ScoreboardReplaySource,
    private readonly builder = new ScoreboardBuilder(),
    private readonly now: () => Date = () => new Date(),
    private readonly cache?: ScoreboardProjectionCache,
    private readonly builds = new ScoreboardBuildCoordinator(),
  ) {}

  async read(input: ReadScoreboardInput): Promise<ScoreboardProjection> {
    const now = this.now()
    requireValidDate(now)
    let contest: ScoreboardContestState
    try {
      contest = await this.repository.readContestState(input.contestId)
    }
    catch (error) {
      if (!(error instanceof ScoreboardContestNotFoundError)) throw error
      throw new ScoreboardViewServiceError('scoreboard.not_found', '排行榜不存在或尚未公开')
    }
    if (input.view === 'internal') {
      if (input.viewerRole !== 'organizer' && input.viewerRole !== 'admin') {
        throw new ScoreboardViewServiceError(
          'scoreboard.internal_forbidden',
          '当前账号无权查看内部实时排行榜',
        )
      }
    }
    else if (contest.publicationStatus === 'draft' || contest.visibility !== 'public') {
      throw new ScoreboardViewServiceError('scoreboard.not_found', '排行榜不存在或尚未公开')
    }

    if (input.scope.type === 'division'
      && !await this.repository.divisionExists(input.contestId, input.scope.divisionId)) {
      throw new ScoreboardViewServiceError('scoreboard.scope_invalid', '排行榜分组不存在')
    }

    if (input.view === 'internal') {
      return this.materialize({
        contest,
        scope: input.scope,
        view: 'internal',
        state: 'live',
        version: contest.currentVersion,
        now,
        persist: true,
      })
    }

    const settled = contest.publicationStatus === 'archived'
      || now.getTime() >= contest.endAt.getTime()
    if (settled) {
      return this.cachedMaterialize({
        contest,
        scope: input.scope,
        view: 'public',
        state: 'settled',
        version: contest.currentVersion,
        now,
        persist: true,
      })
    }

    if (contest.freezeAt && now.getTime() >= contest.freezeAt.getTime()) {
      const scopeKey = scopeKeyFor(input.scope)
      const version = await this.repository.readLatestSnapshotVersion({
        contestId: contest.contestId,
        view: 'public',
        scopeKey,
      })
      if (version !== null) {
        const descriptor = {
          contestId: contest.contestId,
          view: 'public' as const,
          scopeKey,
          version,
          state: 'frozen' as const,
          frozenAt: contest.freezeAt.toISOString(),
        }
        const cached = await this.readCache(descriptor)
        if (cached) return cached
        const existing = await this.repository.readSnapshot({
          contestId: contest.contestId,
          view: 'public',
          scopeKey,
          version,
        })
        if (existing) {
          const value = projection(existing, 'frozen', contest.freezeAt)
          await this.writeCache(value)
          return value
        }
      }
      const buildDescriptor: ScoreboardCacheDescriptor = {
        contestId: contest.contestId,
        view: 'public',
        scopeKey,
        version: version ?? 0,
        state: 'frozen',
        frozenAt: contest.freezeAt.toISOString(),
      }
      return this.builds.run(
        scoreboardBuildKey(buildDescriptor),
        () => this.readLatestFrozen(contest, input.scope),
        async () => {
          const winner = await this.readLatestFrozen(contest, input.scope)
          if (winner) return winner
          const value = await this.materialize({
            contest,
            scope: input.scope,
            view: 'public',
            state: 'frozen',
            now,
            factsBefore: contest.freezeAt!,
            persist: true,
            preferLatestExisting: true,
          })
          await this.writeCache(value)
          return value
        },
      )
    }

    return this.cachedMaterialize({
      contest,
      scope: input.scope,
      view: 'public',
      state: 'live',
      version: contest.currentVersion,
      now,
      persist: true,
    })
  }

  private async cachedMaterialize(input: {
    contest: ScoreboardContestState
    scope: ScoreboardScope
    view: 'public'
    state: 'live' | 'settled'
    version: number
    now: Date
    persist: boolean
  }): Promise<ScoreboardProjection> {
    const descriptor: ScoreboardCacheDescriptor = {
      contestId: input.contest.contestId,
      view: input.view,
      scopeKey: scopeKeyFor(input.scope),
      version: input.version,
      state: input.state,
      frozenAt: null,
    }
    const cached = await this.readCache(descriptor)
    if (cached) return cached
    const stored = await this.readStoredProjection(descriptor, input.contest.freezeAt)
    if (stored) {
      await this.writeCache(stored)
      return stored
    }
    return this.builds.run(
      scoreboardBuildKey(descriptor),
      async () => {
        const winner = await this.readCache(descriptor)
          ?? await this.readStoredProjection(descriptor, input.contest.freezeAt)
        if (winner) await this.writeCache(winner)
        return winner
      },
      async mode => this.rebuildOrFallback(input, descriptor, mode),
    )
  }

  private async rebuildOrFallback(
    input: {
      contest: ScoreboardContestState
      scope: ScoreboardScope
      view: 'public'
      state: 'live' | 'settled'
      version: number
      now: Date
      persist: boolean
    },
    descriptor: ScoreboardCacheDescriptor,
    mode: ScoreboardBuildMode,
  ): Promise<ScoreboardProjection> {
    const winner = await this.readCache(descriptor)
      ?? await this.readStoredProjection(descriptor, input.contest.freezeAt)
    if (winner) return winner
    if (mode === 'contention_timeout') {
      const stale = await this.readStaleProjection(input)
      if (stale) return stale
    }
    try {
      const value = await this.materialize(input)
      await this.writeCache(value)
      return value
    }
    catch (error) {
      const stale = await this.readStaleProjection(input)
      if (stale) return stale
      throw error
    }
  }

  private async readStoredProjection(
    descriptor: ScoreboardCacheDescriptor,
    freezeAt: Date | null,
  ): Promise<ScoreboardProjection | null> {
    const stored = await this.repository.readSnapshot({
      contestId: descriptor.contestId,
      view: descriptor.view,
      scopeKey: descriptor.scopeKey,
      version: descriptor.version,
    })
    return stored ? projection(stored, descriptor.state, freezeAt) : null
  }

  private async readStaleProjection(input: {
    contest: ScoreboardContestState
    scope: ScoreboardScope
    state: 'live' | 'settled'
  }): Promise<ScoreboardProjection | null> {
    const stored = await this.repository.readLatestSnapshot({
      contestId: input.contest.contestId,
      view: 'public',
      scopeKey: scopeKeyFor(input.scope),
    })
    if (!stored || stored.version >= input.contest.currentVersion) return null
    return projection(stored, input.state, input.contest.freezeAt, 'stale')
  }

  private async readLatestFrozen(
    contest: ScoreboardContestState,
    scope: ScoreboardScope,
  ): Promise<ScoreboardProjection | null> {
    const stored = await this.repository.readLatestSnapshot({
      contestId: contest.contestId,
      view: 'public',
      scopeKey: scopeKeyFor(scope),
    })
    if (!stored) return null
    const value = projection(stored, 'frozen', contest.freezeAt)
    const cached = await this.readCache({
      contestId: value.contestId,
      view: 'public',
      scopeKey: value.board.scopeKey,
      version: value.version,
      state: 'frozen',
      frozenAt: value.frozenAt,
    })
    if (cached) return cached
    await this.writeCache(value)
    return value
  }

  private async readCache(descriptor: Parameters<ScoreboardProjectionCache['get']>[0]) {
    try {
      return await this.cache?.get(descriptor) ?? null
    }
    catch {
      return null
    }
  }

  private async writeCache(value: ScoreboardProjection): Promise<void> {
    if (value.freshness !== 'current') return
    try {
      await this.cache?.set(value)
    }
    catch {
      // Cache failures never change authorization or authoritative scoreboard reads.
    }
  }

  private async materialize(input: {
    contest: ScoreboardContestState
    scope: ScoreboardScope
    view: ScoreboardView
    state: ScoreboardProjectionState
    version?: number
    now: Date
    factsBefore?: Date
    persist: boolean
    preferExisting?: boolean
    preferLatestExisting?: boolean
  }): Promise<ScoreboardProjection> {
    const scopeKey = scopeKeyFor(input.scope)
    if (input.preferLatestExisting) {
      const existing = await this.repository.readLatestSnapshot({
        contestId: input.contest.contestId,
        view: input.view,
        scopeKey,
      })
      if (existing) return projection(existing, input.state, input.contest.freezeAt)
    }
    if (input.preferExisting || input.state === 'settled') {
      if (input.version === undefined) {
        throw new ScoreboardSnapshotConflictError('Exact snapshot lookup requires a version')
      }
      const existing = await this.repository.readSnapshot({
        contestId: input.contest.contestId,
        view: input.view,
        scopeKey,
        version: input.version,
      })
      if (existing) return projection(existing, input.state, input.contest.freezeAt)
    }

    const replay = await this.replays.replay(input.contest.contestId, input.factsBefore
      ? { factsBefore: input.factsBefore }
      : undefined)
    const version = input.version ?? replay.factVersion
    if (input.version !== undefined && input.version !== replay.factVersion) {
      throw new ScoreboardSnapshotConflictError(
        `Scoreboard version ${input.version} does not match replayed facts ${replay.factVersion}`,
      )
    }
    const board = this.builder.build(replay, input.scope)
    const generated: ScoreboardSnapshotRecord = {
      contestId: input.contest.contestId,
      view: input.view,
      scope: { ...input.scope },
      scopeKey: board.scopeKey,
      version,
      board,
      builtAt: input.now,
    }
    const snapshot = input.persist
      ? await this.repository.writeSnapshot(generated)
      : generated
    return projection(snapshot, input.state, input.contest.freezeAt)
  }
}

function scopeKeyFor(scope: ScoreboardScope): string {
  return scope.type === 'overall' ? 'overall' : scope.divisionId
}

function projection(
  snapshot: ScoreboardSnapshotRecord,
  state: ScoreboardProjectionState,
  freezeAt: Date | null,
  freshness: ScoreboardProjection['freshness'] = 'current',
): ScoreboardProjection {
  return {
    schema: 'scoreboard-projection.v1',
    contestId: snapshot.contestId,
    view: snapshot.view,
    state,
    freshness,
    version: snapshot.version,
    frozenAt: state === 'frozen' ? freezeAt?.toISOString() ?? null : null,
    builtAt: snapshot.builtAt.toISOString(),
    board: snapshot.board,
  }
}

function requireValidDate(value: Date) {
  if (!Number.isFinite(value.getTime())) {
    throw new ScoreboardViewServiceError('scoreboard.time_invalid', '排行榜读取时间无效')
  }
}
