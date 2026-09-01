import { timingSafeEqual } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import {
  challengeFlagPolicySchema,
  challengeScoringPolicySchema,
  type ChallengeFlagPolicy,
  type ChallengeScoringPolicy,
} from '../../../shared/contracts/challenges'
import {
  ScoreAdjustmentArchivedContestError,
  ScoreAdjustmentRequestConflictError,
  SubmissionChallengeClosedError,
  SubmissionChallengeUnavailableError,
  SubmissionContestNotFoundError,
  SubmissionContestNotRunningError,
  SubmissionCursorInvalidError,
  SubmissionLimitReachedError,
  SubmissionParticipationNotAcceptedError,
  SubmissionParticipationNotFoundError,
  SubmissionRequestConflictError,
  SubmissionTeamRequiredError,
  type AppendSubmissionCommand,
  type ManagedSubmissionPage,
  type RecordScoreAdjustmentCommand,
  type ScoreAdjustmentRecord,
  type StoredSubmission,
  type SubmissionAdmission,
  type SubmissionAdmissionCommand,
  type SubmissionMode,
  type SubmissionRepository,
  type SubmissionResult,
} from '../../domains/submissions/repository'
import { calculateChallengeScore } from '../../domains/submissions/scoring'

interface ContestRow {
  publication_status: 'draft' | 'published' | 'archived'
  start_at: Date
  end_at: Date
  practice_enabled: boolean
}

interface ParticipationRow {
  id: string
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn'
}

interface ChallengeRow {
  id: string
  enabled: boolean
  publish_at: Date | null
  close_at: Date | null
  submission_limit: number | null
  flag_format: string | null
  flag_policy: ChallengeFlagPolicy
  scoring_policy: ChallengeScoringPolicy
}

interface SubmissionRow {
  id: string
  contest_id: string
  contest_challenge_id: string
  participation_id: string
  user_id: string
  mode: SubmissionMode
  result: SubmissionResult
  submitted_at: Date
}

interface ExistingSubmissionRow extends SubmissionRow {
  answer_digest: Buffer
}

interface SolveRow {
  solve_order: number
}

interface ScoreAdjustmentRow {
  id: string
  contest_id: string
  participation_id: string
  points_delta: number
  reason: string
  created_by: string
  request_id: string
  created_at: Date
}

export class PostgresSubmissionRepository implements SubmissionRepository {
  constructor(private readonly pool: Pool) {}

  async admit(command: SubmissionAdmissionCommand): Promise<SubmissionAdmission> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const result = await this.admitWith(connection, command, 'admit')
      await connection.query('COMMIT')
      return result
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
  }

  async append(command: AppendSubmissionCommand): Promise<StoredSubmission> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const existing = await this.readByRequestId(connection, command.requestId)
      if (existing) {
        if (!sameRequest(existing, command)) throw new SubmissionRequestConflictError()
        await connection.query('COMMIT')
        return submissionRecord(existing)
      }

      const admission = await this.admitWith(connection, command, 'append')
      const alreadySolved = command.result === 'correct'
        ? await this.hasSolve(
            connection,
            admission.participationId,
            admission.challengeId,
            admission.mode,
          )
        : false
      const result = alreadySolved ? 'already_solved' : command.result
      const inserted = await connection.query<SubmissionRow>(
        `INSERT INTO submissions
           (contest_id, contest_challenge_id, participation_id, user_id,
            mode, result, answer_digest, answer_ciphertext, request_id,
            submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, contest_id, contest_challenge_id, participation_id,
                   user_id, mode::text, result::text, submitted_at`,
        [
          admission.contestId,
          admission.challengeId,
          admission.participationId,
          command.userId,
          admission.mode,
          result,
          command.answerDigest,
          command.answerCiphertext,
          command.requestId,
          command.at,
        ],
      )
      if (result === 'correct') {
        await this.createSolve(
          connection,
          inserted.rows[0]!,
          admission.teamId,
          admission.teamName,
          admission.scoringPolicy,
          admission.mode,
        )
      }
      await connection.query('COMMIT')
      return submissionRecord(inserted.rows[0]!)
    }
    catch (error) {
      await connection.query('ROLLBACK')
      if (isRequestIdConflict(error)) {
        const existing = await this.readByRequestId(this.pool, command.requestId)
        if (existing && sameRequest(existing, command)) return submissionRecord(existing)
        throw new SubmissionRequestConflictError()
      }
      throw error
    }
    finally {
      connection.release()
    }
  }

  async listManaged(
    contestId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<ManagedSubmissionPage> {
    const contest = await this.pool.query('SELECT 1 FROM contests WHERE id = $1', [contestId])
    if (!contest.rows[0]) throw new SubmissionContestNotFoundError()

    let anchor: { id: string, submitted_at: Date } | null = null
    if (cursor) {
      const result = await this.pool.query<{ id: string, submitted_at: Date }>(
        `SELECT id, submitted_at
         FROM submissions
         WHERE contest_id = $1 AND id::text = $2`,
        [contestId, cursor],
      )
      anchor = result.rows[0] ?? null
      if (!anchor) throw new SubmissionCursorInvalidError()
    }

    const result = await this.pool.query<SubmissionRow>(
      `SELECT id, contest_id, contest_challenge_id, participation_id,
              user_id, mode::text, result::text, submitted_at
       FROM submissions
       WHERE contest_id = $1
         AND ($2::timestamptz IS NULL
           OR (submitted_at, id) < ($2::timestamptz, $3::uuid))
       ORDER BY submitted_at DESC, id DESC
       LIMIT $4`,
      [contestId, anchor?.submitted_at ?? null, anchor?.id ?? null, limit + 1],
    )
    const hasMore = result.rows.length > limit
    const rows = result.rows.slice(0, limit)
    return {
      items: rows.map(submissionRecord),
      nextCursor: hasMore ? rows.at(-1)!.id : null,
      hasMore,
    }
  }

  async recordScoreAdjustment(
    command: RecordScoreAdjustmentCommand,
  ): Promise<ScoreAdjustmentRecord> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const existing = await this.readScoreAdjustmentByRequestId(connection, command.requestId)
      if (existing) {
        if (!sameScoreAdjustment(existing, command)) throw new ScoreAdjustmentRequestConflictError()
        await connection.query('COMMIT')
        return scoreAdjustmentRecord(existing)
      }

      const contest = await connection.query<{ publication_status: string }>(
        `SELECT publication_status::text
         FROM contests
         WHERE id = $1
         FOR UPDATE`,
        [command.contestId],
      )
      if (!contest.rows[0]) throw new SubmissionContestNotFoundError()
      if (contest.rows[0].publication_status === 'archived') {
        throw new ScoreAdjustmentArchivedContestError()
      }

      const participation = await connection.query(
        `SELECT 1
         FROM participations
         WHERE id = $1 AND contest_id = $2
         FOR UPDATE`,
        [command.participationId, command.contestId],
      )
      if (!participation.rows[0]) throw new SubmissionParticipationNotFoundError()

      const inserted = await connection.query<ScoreAdjustmentRow>(
        `INSERT INTO score_adjustments
           (contest_id, participation_id, points_delta, reason,
            created_by, request_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, contest_id, participation_id, points_delta, reason,
                   created_by, request_id, created_at`,
        [
          command.contestId,
          command.participationId,
          command.pointsDelta,
          command.reason,
          command.actorId,
          command.requestId,
          command.at,
        ],
      )
      const adjustment = inserted.rows[0]!
      const scoreboardVersion = await this.advanceScoreboardVersion(
        connection,
        command.contestId,
        command.at,
      )
      await connection.query(
        `INSERT INTO domain_outbox
           (aggregate_type, aggregate_id, event_type, dedupe_key, payload,
            occurred_at, available_at)
         VALUES ('contest', $1, 'scoreboard.version_changed', $2, $3, $4, $4)`,
        [
          command.contestId,
          `scoreboard:${command.contestId}:adjustment:${adjustment.id}`,
          {
            contest_id: command.contestId,
            version: scoreboardVersion,
            reason: 'score_adjustment',
            adjustment_id: adjustment.id,
            participation_id: command.participationId,
            points_delta: command.pointsDelta,
          },
          command.at,
        ],
      )
      await connection.query(
        `INSERT INTO audit_events
           (actor_user_id, action, target_type, target_id, reason, outcome,
            request_id, changes, metadata, occurred_at)
         VALUES ($1, 'score.adjustment.recorded', 'score_adjustment', $2, $3,
                 'succeeded', $4, $5, $6, $7)`,
        [
          command.actorId,
          adjustment.id,
          command.reason,
          command.requestId,
          {
            contest_id: command.contestId,
            participation_id: command.participationId,
            points_delta: command.pointsDelta,
          },
          { scoreboard_version: scoreboardVersion },
          command.at,
        ],
      )
      await connection.query('COMMIT')
      return scoreAdjustmentRecord(adjustment)
    }
    catch (error) {
      await connection.query('ROLLBACK')
      if (isScoreAdjustmentRequestIdConflict(error)) {
        const existing = await this.readScoreAdjustmentByRequestId(this.pool, command.requestId)
        if (existing && sameScoreAdjustment(existing, command)) {
          return scoreAdjustmentRecord(existing)
        }
        throw new ScoreAdjustmentRequestConflictError()
      }
      throw error
    }
    finally {
      connection.release()
    }
  }

  private async admitWith(
    connection: PoolClient,
    command: SubmissionAdmissionCommand,
    operation: 'admit' | 'append',
  ): Promise<SubmissionAdmission> {
    const participationLock = operation === 'append' ? 'FOR UPDATE' : 'FOR SHARE'
    const challengeLock = operation === 'append' ? 'FOR UPDATE' : 'FOR SHARE'
    const contestResult = await connection.query<ContestRow>(
      `SELECT publication_status::text, start_at, end_at, practice_enabled
       FROM contests
       WHERE id = $1
       FOR SHARE`,
      [command.contestId],
    )
    const contest = contestResult.rows[0]
    if (!contest
      || contest.publication_status !== 'published'
      || command.at.getTime() < contest.start_at.getTime()) {
      throw new SubmissionContestNotRunningError()
    }
    let mode: SubmissionMode
    if (command.at.getTime() < contest.end_at.getTime()) mode = 'official'
    else if (contest.practice_enabled) mode = 'practice'
    else throw new SubmissionContestNotRunningError()

    const membership = await connection.query<{ team_id: string, team_name: string }>(
      `SELECT tm.team_id, t.name AS team_name
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       WHERE tm.user_id = $1
       FOR SHARE OF tm, t`,
      [command.userId],
    )
    const teamId = membership.rows[0]?.team_id
    if (!teamId) throw new SubmissionTeamRequiredError()
    const teamName = membership.rows[0]!.team_name

    const participationResult = await connection.query<ParticipationRow>(
      `SELECT id, status::text
       FROM participations
       WHERE contest_id = $1 AND team_id = $2
       ${participationLock}`,
      [command.contestId, teamId],
    )
    const participation = participationResult.rows[0]
    if (!participation || participation.status !== 'accepted') {
      throw new SubmissionParticipationNotAcceptedError()
    }

    const challengeResult = await connection.query<ChallengeRow>(
      `SELECT id, enabled, publish_at, close_at, submission_limit,
              flag_format, flag_policy, scoring_policy
       FROM contest_challenges
       WHERE contest_id = $1 AND id = $2
       ${challengeLock}`,
      [command.contestId, command.challengeId],
    )
    const challenge = challengeResult.rows[0]
    if (!challenge
      || !challenge.enabled
      || (challenge.publish_at !== null
        && command.at.getTime() < challenge.publish_at.getTime())) {
      throw new SubmissionChallengeUnavailableError()
    }
    if (mode === 'official'
      && challenge.close_at !== null
      && command.at.getTime() >= challenge.close_at.getTime()) {
      throw new SubmissionChallengeClosedError()
    }

    if (challenge.submission_limit !== null) {
      const count = await connection.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM submissions
         WHERE participation_id = $1
           AND contest_challenge_id = $2
           AND mode = $3`,
        [participation.id, challenge.id, mode],
      )
      if (Number(count.rows[0]?.count ?? '0') >= challenge.submission_limit) {
        throw new SubmissionLimitReachedError()
      }
    }

    return {
      contestId: command.contestId,
      challengeId: challenge.id,
      participationId: participation.id,
      teamId,
      teamName,
      flagFormat: challenge.flag_format,
      flagPolicy: challengeFlagPolicySchema.parse(challenge.flag_policy),
      scoringPolicy: challengeScoringPolicySchema.parse(challenge.scoring_policy),
      mode,
    }
  }

  private async hasSolve(
    connection: PoolClient,
    participationId: string,
    challengeId: string,
    mode: SubmissionMode,
  ) {
    const result = await connection.query(
      `SELECT 1
       FROM solves
       WHERE participation_id = $1
         AND contest_challenge_id = $2
         AND mode = $3`,
      [participationId, challengeId, mode],
    )
    return Boolean(result.rows[0])
  }

  private async createSolve(
    connection: PoolClient,
    submission: SubmissionRow,
    teamId: string,
    teamName: string,
    scoringPolicy: ChallengeScoringPolicy,
    mode: SubmissionMode,
  ) {
    const orderResult = await connection.query<{ solve_order: number }>(
      `SELECT count(*)::integer + 1 AS solve_order
       FROM solves
       WHERE contest_challenge_id = $1 AND mode = $2`,
      [submission.contest_challenge_id, mode],
    )
    const solveOrder = orderResult.rows[0]!.solve_order
    const awardedScore = mode === 'official'
      ? calculateChallengeScore(scoringPolicy, solveOrder)
      : 0
    const solve = await connection.query<SolveRow>(
      `INSERT INTO solves
         (submission_id, contest_id, contest_challenge_id, participation_id,
          mode, awarded_score, solve_order, solved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING solve_order`,
      [
        submission.id,
        submission.contest_id,
        submission.contest_challenge_id,
        submission.participation_id,
        mode,
        awardedScore,
        solveOrder,
        submission.submitted_at,
      ],
    )
    if (mode === 'practice') return
    const scoreboardVersion = await this.advanceScoreboardVersion(
      connection,
      submission.contest_id,
      submission.submitted_at,
    )
    await connection.query(
      `INSERT INTO domain_outbox
         (aggregate_type, aggregate_id, event_type, dedupe_key, payload,
          occurred_at, available_at)
       VALUES ('contest', $1, 'scoreboard.version_changed', $2, $3, $4, $4)`,
      [
        submission.contest_id,
        `scoreboard:${submission.contest_id}:solve:${submission.id}`,
        {
          contest_id: submission.contest_id,
          version: scoreboardVersion,
          reason: 'official_solve',
          challenge_id: submission.contest_challenge_id,
          participation_id: submission.participation_id,
          solve_order: solveOrder,
          current_points: awardedScore,
        },
        submission.submitted_at,
      ],
    )
    if (solve.rows[0]!.solve_order !== 1) return

    await connection.query(
      `INSERT INTO contest_events
         (contest_id, event_type, event_key, occurred_at, visible_at, payload)
       VALUES ($1, 'first_solve', $2, $3, $3, $4)`,
      [
        submission.contest_id,
        `challenge:${submission.contest_challenge_id}:first-solve`,
        submission.submitted_at,
        {
          challenge_id: submission.contest_challenge_id,
          team_id: teamId,
          team_name: teamName,
        },
      ],
    )
  }

  private async advanceScoreboardVersion(
    connection: PoolClient,
    contestId: string,
    at: Date,
  ): Promise<number> {
    const result = await connection.query<{ version: string }>(
      `INSERT INTO scoreboard_versions (contest_id, version, updated_at)
       VALUES ($1, 1, $2)
       ON CONFLICT (contest_id) DO UPDATE
       SET version = scoreboard_versions.version + 1,
           updated_at = EXCLUDED.updated_at
       RETURNING version::text`,
      [contestId, at],
    )
    const version = Number(result.rows[0]!.version)
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new Error('Scoreboard version exceeded the supported integer range')
    }
    return version
  }

  private async readByRequestId(
    queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    requestId: string,
  ) {
    const result = await queryable.query<ExistingSubmissionRow>(
      `SELECT id, contest_id, contest_challenge_id, participation_id,
              user_id, mode::text, result::text, answer_digest, submitted_at
       FROM submissions
       WHERE request_id = $1`,
      [requestId],
    )
    return result.rows[0] ?? null
  }

  private async readScoreAdjustmentByRequestId(
    queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    requestId: string,
  ) {
    const result = await queryable.query<ScoreAdjustmentRow>(
      `SELECT id, contest_id, participation_id, points_delta, reason,
              created_by, request_id, created_at
       FROM score_adjustments
       WHERE request_id = $1`,
      [requestId],
    )
    return result.rows[0] ?? null
  }
}

function submissionRecord(row: SubmissionRow): StoredSubmission {
  return {
    id: row.id,
    contestId: row.contest_id,
    challengeId: row.contest_challenge_id,
    participationId: row.participation_id,
    userId: row.user_id,
    mode: row.mode,
    result: row.result,
    submittedAt: row.submitted_at,
  }
}

function sameRequest(existing: ExistingSubmissionRow, command: AppendSubmissionCommand) {
  return existing.contest_id === command.contestId
    && existing.contest_challenge_id === command.challengeId
    && existing.user_id === command.userId
    && (existing.result === command.result
      || (command.result === 'correct' && existing.result === 'already_solved'))
    && existing.answer_digest.byteLength === command.answerDigest.byteLength
    && timingSafeEqual(existing.answer_digest, command.answerDigest)
}

function scoreAdjustmentRecord(row: ScoreAdjustmentRow): ScoreAdjustmentRecord {
  return {
    id: row.id,
    contestId: row.contest_id,
    participationId: row.participation_id,
    pointsDelta: row.points_delta,
    reason: row.reason,
    createdBy: row.created_by,
    requestId: row.request_id,
    createdAt: row.created_at,
  }
}

function sameScoreAdjustment(
  existing: ScoreAdjustmentRow,
  command: RecordScoreAdjustmentCommand,
) {
  return existing.contest_id === command.contestId
    && existing.participation_id === command.participationId
    && existing.points_delta === command.pointsDelta
    && existing.reason === command.reason
    && existing.created_by === command.actorId
}

function isRequestIdConflict(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: string }).code === '23505'
    && (error as { constraint?: string }).constraint === 'submissions_request_id_unique'
}

function isScoreAdjustmentRequestIdConflict(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: string }).code === '23505'
    && (error as { constraint?: string }).constraint === 'score_adjustments_request_id_unique'
}
