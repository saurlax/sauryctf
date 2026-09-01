import { isDeepStrictEqual } from 'node:util'
import type { Pool } from 'pg'
import {
  ScoreboardContestNotFoundError,
  ScoreboardSnapshotConflictError,
  type ScoreboardContestState,
  type ScoreboardSnapshotRecord,
  type ScoreboardView,
  type ScoreboardViewRepository,
} from '../../domains/scoreboards/view-service'
import type { ScoreboardReadModel, ScoreboardScope } from '../../domains/scoreboards/builder'

interface ContestStateRow {
  id: string
  publication_status: ScoreboardContestState['publicationStatus']
  visibility: ScoreboardContestState['visibility']
  scoreboard_freeze_at: Date | null
  end_at: Date
  current_version: string
}

interface SnapshotRow {
  contest_id: string
  view: ScoreboardView
  division_id: string | null
  scope_key: string
  version: string
  payload: unknown
  built_at: Date
}

export class PostgresScoreboardViewRepository implements ScoreboardViewRepository {
  constructor(private readonly pool: Pool) {}

  async readContestState(contestId: string): Promise<ScoreboardContestState> {
    const result = await this.pool.query<ContestStateRow>(
      `SELECT c.id, c.publication_status::text, c.visibility::text,
              c.scoreboard_freeze_at, c.end_at,
              coalesce(sv.version, 0)::text AS current_version
       FROM contests c
       LEFT JOIN scoreboard_versions sv ON sv.contest_id = c.id
       WHERE c.id = $1`,
      [contestId],
    )
    const row = result.rows[0]
    if (!row) throw new ScoreboardContestNotFoundError()
    requireValidDate(row.end_at, 'contest end time')
    if (row.scoreboard_freeze_at) requireValidDate(row.scoreboard_freeze_at, 'scoreboard freeze time')
    return {
      contestId: row.id,
      publicationStatus: row.publication_status,
      visibility: row.visibility,
      freezeAt: row.scoreboard_freeze_at,
      endAt: row.end_at,
      currentVersion: safeVersion(row.current_version),
    }
  }

  async divisionExists(contestId: string, divisionId: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM divisions WHERE contest_id = $1 AND id = $2',
      [contestId, divisionId],
    )
    return result.rowCount === 1
  }

  async readLatestSnapshot(input: {
    contestId: string
    view: ScoreboardView
    scopeKey: string
  }): Promise<ScoreboardSnapshotRecord | null> {
    const result = await this.pool.query<SnapshotRow>(
      `SELECT contest_id, view::text, division_id, scope_key,
              version::text, payload, built_at
       FROM scoreboard_snapshots
       WHERE contest_id = $1 AND view = $2 AND scope_key = $3
       ORDER BY version DESC
       LIMIT 1`,
      [input.contestId, input.view, input.scopeKey],
    )
    return result.rows[0] ? snapshotRecord(result.rows[0]) : null
  }

  async readLatestSnapshotVersion(input: {
    contestId: string
    view: ScoreboardView
    scopeKey: string
  }): Promise<number | null> {
    const result = await this.pool.query<{ version: string }>(
      `SELECT version::text
       FROM scoreboard_snapshots
       WHERE contest_id = $1 AND view = $2 AND scope_key = $3
       ORDER BY version DESC
       LIMIT 1`,
      [input.contestId, input.view, input.scopeKey],
    )
    return result.rows[0] ? safeVersion(result.rows[0].version) : null
  }

  async readSnapshot(input: {
    contestId: string
    view: ScoreboardView
    scopeKey: string
    version: number
  }): Promise<ScoreboardSnapshotRecord | null> {
    const result = await this.pool.query<SnapshotRow>(
      `SELECT contest_id, view::text, division_id, scope_key,
              version::text, payload, built_at
       FROM scoreboard_snapshots
       WHERE contest_id = $1 AND view = $2 AND scope_key = $3 AND version = $4`,
      [input.contestId, input.view, input.scopeKey, input.version],
    )
    return result.rows[0] ? snapshotRecord(result.rows[0]) : null
  }

  async writeSnapshot(snapshot: ScoreboardSnapshotRecord): Promise<ScoreboardSnapshotRecord> {
    const divisionId = snapshot.scope.type === 'division' ? snapshot.scope.divisionId : null
    const inserted = await this.pool.query<SnapshotRow>(
      `INSERT INTO scoreboard_snapshots
         (contest_id, view, division_id, scope_key, version, payload, built_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (contest_id, view, scope_key, version) DO NOTHING
       RETURNING contest_id, view::text, division_id, scope_key,
                 version::text, payload, built_at`,
      [
        snapshot.contestId,
        snapshot.view,
        divisionId,
        snapshot.scopeKey,
        snapshot.version,
        snapshot.board,
        snapshot.builtAt,
      ],
    )
    const stored = inserted.rows[0]
      ? snapshotRecord(inserted.rows[0])
      : await this.readSnapshot({
          contestId: snapshot.contestId,
          view: snapshot.view,
          scopeKey: snapshot.scopeKey,
          version: snapshot.version,
        })
    if (!stored || !isDeepStrictEqual(stored.board, snapshot.board)) {
      throw new ScoreboardSnapshotConflictError(
        `Scoreboard snapshot ${snapshot.contestId}/${snapshot.view}/${snapshot.scopeKey}/${snapshot.version} conflicts`,
      )
    }
    return stored
  }
}

function snapshotRecord(row: SnapshotRow): ScoreboardSnapshotRecord {
  const board = scoreboardReadModel(row.payload)
  const scope: ScoreboardScope = row.division_id
    ? { type: 'division', divisionId: row.division_id }
    : { type: 'overall' }
  if (board.scopeKey !== row.scope_key || !isDeepStrictEqual(board.scope, scope)) {
    throw new ScoreboardSnapshotConflictError('Stored scoreboard scope does not match its database key')
  }
  requireValidDate(row.built_at, 'scoreboard snapshot build time')
  return {
    contestId: row.contest_id,
    view: row.view,
    scope,
    scopeKey: row.scope_key,
    version: safeVersion(row.version),
    board,
    builtAt: row.built_at,
  }
}

function scoreboardReadModel(value: unknown): ScoreboardReadModel {
  if (!isRecord(value)
    || value.schema !== 'scoreboard.v1'
    || !isRecord(value.scope)
    || typeof value.scopeKey !== 'string'
    || !Array.isArray(value.challenges)
    || !Array.isArray(value.rows)) {
    throw new ScoreboardSnapshotConflictError('Stored scoreboard payload is invalid')
  }
  return value as unknown as ScoreboardReadModel
}

function safeVersion(value: string): number {
  const version = Number(value)
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new RangeError('Scoreboard version exceeded the supported integer range')
  }
  return version
}

function requireValidDate(value: Date, label: string) {
  if (!Number.isFinite(value.getTime())) throw new RangeError(`Invalid ${label}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
