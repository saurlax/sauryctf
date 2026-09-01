import { timingSafeEqual } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { challengeFlagPolicySchema, type ChallengeFlagPolicy } from '../../../shared/contracts/challenges'
import {
  SubmissionChallengeClosedError,
  SubmissionChallengeUnavailableError,
  SubmissionContestNotFoundError,
  SubmissionContestNotRunningError,
  SubmissionCursorInvalidError,
  SubmissionLimitReachedError,
  SubmissionParticipationNotAcceptedError,
  SubmissionRequestConflictError,
  SubmissionTeamRequiredError,
  type AppendSubmissionCommand,
  type ManagedSubmissionPage,
  type StoredSubmission,
  type SubmissionAdmission,
  type SubmissionAdmissionCommand,
  type SubmissionRepository,
  type SubmissionResult,
} from '../../domains/submissions/repository'

interface ContestRow {
  publication_status: 'draft' | 'published' | 'archived'
  start_at: Date
  end_at: Date
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
}

interface SubmissionRow {
  id: string
  contest_id: string
  contest_challenge_id: string
  participation_id: string
  user_id: string
  mode: 'official'
  result: SubmissionResult
  submitted_at: Date
}

interface ExistingSubmissionRow extends SubmissionRow {
  answer_digest: Buffer
}

interface SolveRow {
  solve_order: number
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
        ? await this.hasOfficialSolve(connection, admission.participationId, admission.challengeId)
        : false
      const result = alreadySolved ? 'already_solved' : command.result
      const inserted = await connection.query<SubmissionRow>(
        `INSERT INTO submissions
           (contest_id, contest_challenge_id, participation_id, user_id,
            mode, result, answer_digest, answer_ciphertext, request_id,
            submitted_at)
         VALUES ($1, $2, $3, $4, 'official', $5, $6, $7, $8, $9)
         RETURNING id, contest_id, contest_challenge_id, participation_id,
                   user_id, mode::text, result::text, submitted_at`,
        [
          admission.contestId,
          admission.challengeId,
          admission.participationId,
          command.userId,
          result,
          command.answerDigest,
          command.answerCiphertext,
          command.requestId,
          command.at,
        ],
      )
      if (result === 'correct') {
        await this.createOfficialSolve(connection, inserted.rows[0]!, admission.teamId, admission.teamName)
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

  private async admitWith(
    connection: PoolClient,
    command: SubmissionAdmissionCommand,
    operation: 'admit' | 'append',
  ): Promise<SubmissionAdmission> {
    const participationLock = operation === 'append' ? 'FOR UPDATE' : 'FOR SHARE'
    const challengeLock = operation === 'append' ? 'FOR UPDATE' : 'FOR SHARE'
    const contestResult = await connection.query<ContestRow>(
      `SELECT publication_status::text, start_at, end_at
       FROM contests
       WHERE id = $1
       FOR SHARE`,
      [command.contestId],
    )
    const contest = contestResult.rows[0]
    if (!contest
      || contest.publication_status !== 'published'
      || command.at.getTime() < contest.start_at.getTime()
      || command.at.getTime() >= contest.end_at.getTime()) {
      throw new SubmissionContestNotRunningError()
    }

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
              flag_format, flag_policy
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
    if (challenge.close_at !== null && command.at.getTime() >= challenge.close_at.getTime()) {
      throw new SubmissionChallengeClosedError()
    }

    if (challenge.submission_limit !== null) {
      const count = await connection.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM submissions
         WHERE participation_id = $1
           AND contest_challenge_id = $2
           AND mode = 'official'`,
        [participation.id, challenge.id],
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
    }
  }

  private async hasOfficialSolve(
    connection: PoolClient,
    participationId: string,
    challengeId: string,
  ) {
    const result = await connection.query(
      `SELECT 1
       FROM solves
       WHERE participation_id = $1
         AND contest_challenge_id = $2
         AND mode = 'official'`,
      [participationId, challengeId],
    )
    return Boolean(result.rows[0])
  }

  private async createOfficialSolve(
    connection: PoolClient,
    submission: SubmissionRow,
    teamId: string,
    teamName: string,
  ) {
    const orderResult = await connection.query<{ solve_order: number }>(
      `SELECT count(*)::integer + 1 AS solve_order
       FROM solves
       WHERE contest_challenge_id = $1 AND mode = 'official'`,
      [submission.contest_challenge_id],
    )
    const solveOrder = orderResult.rows[0]!.solve_order
    const solve = await connection.query<SolveRow>(
      `INSERT INTO solves
         (submission_id, contest_id, contest_challenge_id, participation_id,
          mode, awarded_score, solve_order, solved_at)
       VALUES ($1, $2, $3, $4, 'official', 0, $5, $6)
       RETURNING solve_order`,
      [
        submission.id,
        submission.contest_id,
        submission.contest_challenge_id,
        submission.participation_id,
        solveOrder,
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
    && existing.mode === 'official'
    && (existing.result === command.result
      || (command.result === 'correct' && existing.result === 'already_solved'))
    && existing.answer_digest.byteLength === command.answerDigest.byteLength
    && timingSafeEqual(existing.answer_digest, command.answerDigest)
}

function isRequestIdConflict(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: string }).code === '23505'
    && (error as { constraint?: string }).constraint === 'submissions_request_id_unique'
}
