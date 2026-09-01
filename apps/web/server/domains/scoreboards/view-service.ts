import type { ContestScoringReplay, ScoringReplayOptions } from '../submissions/scoring-replay'
import {
  ScoreboardBuilder,
  type ScoreboardReadModel,
  type ScoreboardScope,
} from './builder'

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
      return this.materialize({
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
      return this.materialize({
        contest,
        scope: input.scope,
        view: 'public',
        state: 'frozen',
        now,
        factsBefore: contest.freezeAt,
        persist: true,
        preferLatestExisting: true,
      })
    }

    return this.materialize({
      contest,
      scope: input.scope,
      view: 'public',
      state: 'live',
      version: contest.currentVersion,
      now,
      persist: false,
    })
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
    const scopeKey = input.scope.type === 'overall' ? 'overall' : input.scope.divisionId
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

function projection(
  snapshot: ScoreboardSnapshotRecord,
  state: ScoreboardProjectionState,
  freezeAt: Date | null,
): ScoreboardProjection {
  return {
    schema: 'scoreboard-projection.v1',
    contestId: snapshot.contestId,
    view: snapshot.view,
    state,
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
