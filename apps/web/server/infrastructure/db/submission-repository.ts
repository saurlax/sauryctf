import { timingSafeEqual } from 'node:crypto'
import {
  challengeFlagPolicySchema,
  challengeScoringPolicySchema,
  type ChallengeFlagPolicy,
  type ChallengeScoringPolicy,
} from '../../../shared/contracts/challenges'
import {
  CheatClueCursorInvalidError,
  CheatClueNotFoundError,
  CheatClueRequestConflictError,
  CheatClueReviewConflictError,
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
  type CheatCluePage,
  type CheatClueRecord,
  type CheatClueStatus,
  type CheatClueType,
  type ManagedSubmissionPage,
  type RecordScoreAdjustmentCommand,
  type ReviewCheatClueCommand,
  type ScoreAdjustmentRecord,
  type StoredSubmission,
  type SubmissionAdmission,
  type SubmissionAdmissionCommand,
  type SubmissionMode,
  type SubmissionRepository,
  type SubmissionResult,
} from '../../domains/submissions/repository'
import { calculateChallengeScore } from '../../domains/submissions/scoring'
import type { DatabaseExecutor } from './executor'

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

interface CheatClueRow {
  id: string
  contest_id: string
  contest_challenge_id: string | null
  participation_id: string | null
  clue_type: CheatClueType
  evidence: Record<string, unknown>
  status: CheatClueStatus
  reviewed_by: string | null
  review_note: string | null
  reviewed_at: Date | null
  created_at: Date
  updated_at: Date
}

interface MatchingSubmissionRow {
  id: string
  participation_id: string
  submitted_at: Date
}

interface CheatClueReviewAuditRow {
  actor_user_id: string | null
  target_id: string | null
  reason: string | null
  changes: {
    contest_id?: unknown
    from_status?: unknown
    to_status?: unknown
    review_note?: unknown
  }
  occurred_at: Date
}

export class PostgresSubmissionRepository implements SubmissionRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async admit(command: SubmissionAdmissionCommand): Promise<SubmissionAdmission> {
    return this.database.transaction(async (connection) => {
      const result = await this.admitWith(connection, command, 'admit')
      return result
    })
  }

  async append(command: AppendSubmissionCommand): Promise<StoredSubmission> {
    try {
      return await this.database.transaction(async (connection) => {
        const existing = await this.readByRequestId(connection, command.requestId)
        if (existing) {
          if (!sameRequest(existing, command)) throw new SubmissionRequestConflictError()
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
        if (admission.mode === 'official') {
          await this.detectCheatClues(
          connection,
          inserted.rows[0]!,
          command.answerDigest,
          admission.flagPolicy.type === 'team-derived',
        )
        }
        return submissionRecord(inserted.rows[0]!)
      })
    }
    catch (error) {
      if (isRequestIdConflict(error)) {
        const existing = await this.readByRequestId(this.database, command.requestId)
        if (existing && sameRequest(existing, command)) return submissionRecord(existing)
        throw new SubmissionRequestConflictError()
      }
      throw error
    }
  }

  async listManaged(
    contestId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<ManagedSubmissionPage> {
    const contest = await this.database.query('SELECT 1 FROM contests WHERE id = $1', [contestId])
    if (!contest.rows[0]) throw new SubmissionContestNotFoundError()

    let anchor: { id: string, submitted_at: Date } | null = null
    if (cursor) {
      const result = await this.database.query<{ id: string, submitted_at: Date }>(
        `SELECT id, submitted_at
         FROM submissions
         WHERE contest_id = $1 AND id::text = $2`,
        [contestId, cursor],
      )
      anchor = result.rows[0] ?? null
      if (!anchor) throw new SubmissionCursorInvalidError()
    }

    const result = await this.database.query<SubmissionRow>(
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
    try {
      return await this.database.transaction(async (connection) => {
        const existing = await this.readScoreAdjustmentByRequestId(connection, command.requestId)
        if (existing) {
          if (!sameScoreAdjustment(existing, command)) throw new ScoreAdjustmentRequestConflictError()
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
        return scoreAdjustmentRecord(adjustment)
      })
    }
    catch (error) {
      if (isScoreAdjustmentRequestIdConflict(error)) {
        const existing = await this.readScoreAdjustmentByRequestId(this.database, command.requestId)
        if (existing && sameScoreAdjustment(existing, command)) {
          return scoreAdjustmentRecord(existing)
        }
        throw new ScoreAdjustmentRequestConflictError()
      }
      throw error
    }
  }

  async listCheatClues(
    contestId: string,
    status: CheatClueStatus | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<CheatCluePage> {
    const contest = await this.database.query('SELECT 1 FROM contests WHERE id = $1', [contestId])
    if (!contest.rows[0]) throw new SubmissionContestNotFoundError()

    let anchor: { id: string, created_at: Date } | null = null
    if (cursor) {
      const result = await this.database.query<{ id: string, created_at: Date }>(
        `SELECT id, created_at
         FROM cheat_clues
         WHERE contest_id = $1
           AND id::text = $2
           AND ($3::text IS NULL OR status::text = $3)`,
        [contestId, cursor, status ?? null],
      )
      anchor = result.rows[0] ?? null
      if (!anchor) throw new CheatClueCursorInvalidError()
    }

    const result = await this.database.query<CheatClueRow>(
      `SELECT id, contest_id, contest_challenge_id, participation_id,
              clue_type, evidence, status::text, reviewed_by, review_note,
              reviewed_at, created_at, updated_at
       FROM cheat_clues
       WHERE contest_id = $1
         AND ($2::text IS NULL OR status::text = $2)
         AND ($3::timestamptz IS NULL
           OR (created_at, id) < ($3::timestamptz, $4::uuid))
       ORDER BY created_at DESC, id DESC
       LIMIT $5`,
      [contestId, status ?? null, anchor?.created_at ?? null, anchor?.id ?? null, limit + 1],
    )
    const hasMore = result.rows.length > limit
    const rows = result.rows.slice(0, limit)
    return {
      items: rows.map(cheatClueRecord),
      nextCursor: hasMore ? rows.at(-1)!.id : null,
      hasMore,
    }
  }

  async reviewCheatClue(command: ReviewCheatClueCommand): Promise<CheatClueRecord> {
    return this.database.transaction(async (connection) => {
      await connection.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`cheat-clue-review:${command.requestId}`],
      )
      const existingAudit = await this.readCheatClueReviewByRequestId(
        connection,
        command.requestId,
      )
      if (existingAudit) {
        if (!sameCheatClueReview(existingAudit, command)) {
          throw new CheatClueRequestConflictError()
        }
        const clue = await this.readCheatClue(
          connection,
          command.contestId,
          command.clueId,
          false,
        )
        if (!clue) throw new CheatClueNotFoundError()
        return reviewedCheatClueRecord(clue, existingAudit, command)
      }

      const clue = await this.readCheatClue(
        connection,
        command.contestId,
        command.clueId,
        true,
      )
      if (!clue) throw new CheatClueNotFoundError()
      if (!canReviewCheatClue(clue.status, command.status)) {
        throw new CheatClueReviewConflictError()
      }

      const finalReview = command.status === 'dismissed' || command.status === 'confirmed'
      const updated = await connection.query<CheatClueRow>(
        `UPDATE cheat_clues
         SET status = $2,
             reviewed_by = CASE WHEN $3::boolean THEN $4::uuid ELSE NULL END,
             review_note = $5,
             reviewed_at = CASE WHEN $3::boolean THEN $6::timestamptz ELSE NULL END,
             updated_at = $6
         WHERE id = $1
         RETURNING id, contest_id, contest_challenge_id, participation_id,
                   clue_type, evidence, status::text, reviewed_by, review_note,
                   reviewed_at, created_at, updated_at`,
        [
          command.clueId,
          command.status,
          finalReview,
          command.actorId,
          command.note,
          command.at,
        ],
      )
      await connection.query(
        `INSERT INTO audit_events
           (actor_user_id, action, target_type, target_id, reason, outcome,
            request_id, changes, metadata, occurred_at)
         VALUES ($1, 'cheat_clue.reviewed', 'cheat_clue', $2, $3,
                 'succeeded', $4, $5, $6, $7)`,
        [
          command.actorId,
          command.clueId,
          command.note,
          command.requestId,
          {
            contest_id: command.contestId,
            from_status: clue.status,
            to_status: command.status,
            review_note: command.note,
          },
          { automatic_action: false },
          command.at,
        ],
      )
      return cheatClueRecord(updated.rows[0]!)
    })
  }

  private async admitWith(
    connection: DatabaseExecutor,
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
    connection: DatabaseExecutor,
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
    connection: DatabaseExecutor,
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
    await this.advanceScoreboardVersion(
      connection,
      submission.contest_id,
      submission.submitted_at,
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

  private async detectCheatClues(
    connection: DatabaseExecutor,
    submission: SubmissionRow,
    answerDigest: Buffer,
    teamDerivedFlag: boolean,
  ) {
    const fingerprint = answerDigest.toString('hex')
    if (submission.result === 'incorrect') {
      await this.detectRepeatedIncorrectAnswer(connection, submission, answerDigest, fingerprint)
      await this.detectSharedIncorrectAnswer(connection, submission, answerDigest, fingerprint)
    }
    await this.detectAbnormalFrequency(connection, submission)
    if (teamDerivedFlag) {
      await this.detectForeignTeamFlag(connection, submission, answerDigest, fingerprint)
    }
  }

  private async detectRepeatedIncorrectAnswer(
    connection: DatabaseExecutor,
    submission: SubmissionRow,
    answerDigest: Buffer,
    fingerprint: string,
  ) {
    const result = await connection.query<{
      matching_count: string
      first_seen_at: Date
      last_seen_at: Date
    }>(
      `SELECT count(*)::text AS matching_count,
              min(submitted_at) AS first_seen_at,
              max(submitted_at) AS last_seen_at
       FROM submissions
       WHERE participation_id = $1
         AND contest_challenge_id = $2
         AND mode = 'official'
         AND result = 'incorrect'
         AND answer_digest = $3`,
      [submission.participation_id, submission.contest_challenge_id, answerDigest],
    )
    const aggregate = result.rows[0]!
    const matchingCount = Number(aggregate.matching_count)
    if (matchingCount < 3) return
    await this.insertCheatClue(connection, {
      key: `repeat:${submission.participation_id}:${submission.contest_challenge_id}:official:${fingerprint}`,
      submission,
      type: 'repeated_incorrect_answer',
      evidence: {
        schema: 'cheat-clue.v1',
        kind: 'repeated_incorrect_answer',
        answer_fingerprint: fingerprint,
        trigger_submission_id: submission.id,
        participation_id: submission.participation_id,
        challenge_id: submission.contest_challenge_id,
        mode: 'official',
        matching_submission_count: matchingCount,
        first_seen_at: aggregate.first_seen_at.toISOString(),
        last_seen_at: aggregate.last_seen_at.toISOString(),
      },
    })
  }

  private async detectSharedIncorrectAnswer(
    connection: DatabaseExecutor,
    submission: SubmissionRow,
    answerDigest: Buffer,
    fingerprint: string,
  ) {
    const result = await connection.query<MatchingSubmissionRow>(
      `SELECT DISTINCT ON (participation_id)
              id, participation_id, submitted_at
       FROM submissions
       WHERE contest_challenge_id = $1
         AND mode = 'official'
         AND result = 'incorrect'
         AND answer_digest = $2
       ORDER BY participation_id, submitted_at, id`,
      [submission.contest_challenge_id, answerDigest],
    )
    if (result.rows.length < 2) return
    const relatedParticipationIds = result.rows.map(row => row.participation_id).sort()
    for (const subject of result.rows) {
      await this.insertCheatClue(connection, {
        key: `shared:${submission.contest_challenge_id}:official:${fingerprint}:${subject.participation_id}`,
        submission: {
          ...submission,
          id: subject.id,
          participation_id: subject.participation_id,
          submitted_at: subject.submitted_at,
        },
        type: 'shared_incorrect_answer',
        evidence: {
          schema: 'cheat-clue.v1',
          kind: 'shared_incorrect_answer',
          answer_fingerprint: fingerprint,
          trigger_submission_id: submission.id,
          subject_submission_id: subject.id,
          participation_id: subject.participation_id,
          related_participation_ids: relatedParticipationIds,
          challenge_id: submission.contest_challenge_id,
          mode: 'official',
          matching_participation_count: relatedParticipationIds.length,
          observed_at: submission.submitted_at.toISOString(),
        },
      })
    }
  }

  private async detectAbnormalFrequency(
    connection: DatabaseExecutor,
    submission: SubmissionRow,
  ) {
    const result = await connection.query<{
      matching_count: string
      first_seen_at: Date
      last_seen_at: Date
    }>(
      `SELECT count(*)::text AS matching_count,
              min(submitted_at) AS first_seen_at,
              max(submitted_at) AS last_seen_at
       FROM submissions
       WHERE participation_id = $1
         AND contest_challenge_id = $2
         AND mode = 'official'
         AND submitted_at > $3::timestamptz - interval '60 seconds'
         AND submitted_at <= $3`,
      [submission.participation_id, submission.contest_challenge_id, submission.submitted_at],
    )
    const aggregate = result.rows[0]!
    const matchingCount = Number(aggregate.matching_count)
    if (matchingCount < 10) return
    const epochMinute = Math.floor(submission.submitted_at.getTime() / 60_000)
    await this.insertCheatClue(connection, {
      key: `frequency:${submission.participation_id}:${submission.contest_challenge_id}:official:${epochMinute}`,
      submission,
      type: 'abnormal_submission_frequency',
      evidence: {
        schema: 'cheat-clue.v1',
        kind: 'abnormal_submission_frequency',
        trigger_submission_id: submission.id,
        participation_id: submission.participation_id,
        challenge_id: submission.contest_challenge_id,
        mode: 'official',
        matching_submission_count: matchingCount,
        window_started_at: aggregate.first_seen_at.toISOString(),
        window_ended_at: aggregate.last_seen_at.toISOString(),
      },
    })
  }

  private async detectForeignTeamFlag(
    connection: DatabaseExecutor,
    submission: SubmissionRow,
    answerDigest: Buffer,
    fingerprint: string,
  ) {
    if (submission.result === 'incorrect') {
      const owners = await connection.query<MatchingSubmissionRow>(
        `SELECT DISTINCT ON (participation_id)
                id, participation_id, submitted_at
         FROM submissions
         WHERE contest_challenge_id = $1
           AND mode = 'official'
           AND result IN ('correct', 'already_solved')
           AND answer_digest = $2
           AND participation_id <> $3
         ORDER BY participation_id, (result = 'correct') DESC, submitted_at, id`,
        [submission.contest_challenge_id, answerDigest, submission.participation_id],
      )
      for (const owner of owners.rows) {
        await this.insertForeignTeamFlagClue(
          connection,
          submission,
          owner,
          fingerprint,
        )
      }
      return
    }

    const offenders = await connection.query<MatchingSubmissionRow>(
      `SELECT id, participation_id, submitted_at
       FROM submissions
       WHERE contest_challenge_id = $1
         AND mode = 'official'
         AND result = 'incorrect'
         AND answer_digest = $2
         AND participation_id <> $3
       ORDER BY submitted_at, id`,
      [submission.contest_challenge_id, answerDigest, submission.participation_id],
    )
    const owner = {
      id: submission.id,
      participation_id: submission.participation_id,
      submitted_at: submission.submitted_at,
    }
    for (const offender of offenders.rows) {
      await this.insertForeignTeamFlagClue(connection, offender, owner, fingerprint, submission)
    }
  }

  private async insertForeignTeamFlagClue(
    connection: DatabaseExecutor,
    offender: MatchingSubmissionRow | SubmissionRow,
    owner: MatchingSubmissionRow,
    fingerprint: string,
    context?: SubmissionRow,
  ) {
    const submission = context ?? offender as SubmissionRow
    await this.insertCheatClue(connection, {
      key: `foreign:${offender.id}:${owner.participation_id}`,
      submission: {
        ...submission,
        id: offender.id,
        participation_id: offender.participation_id,
        submitted_at: offender.submitted_at,
      },
      type: 'foreign_team_flag',
      evidence: {
        schema: 'cheat-clue.v1',
        kind: 'foreign_team_flag',
        answer_fingerprint: fingerprint,
        incorrect_submission_id: offender.id,
        owner_submission_id: owner.id,
        participation_id: offender.participation_id,
        owner_participation_id: owner.participation_id,
        challenge_id: submission.contest_challenge_id,
        mode: 'official',
        observed_at: submission.submitted_at.toISOString(),
      },
    })
  }

  private async insertCheatClue(
    connection: DatabaseExecutor,
    input: {
      key: string
      submission: SubmissionRow
      type: CheatClueType
      evidence: Record<string, unknown>
    },
  ) {
    await connection.query(
      `INSERT INTO cheat_clues
         (clue_key, contest_id, contest_challenge_id, participation_id,
          clue_type, evidence, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       ON CONFLICT (clue_key) DO NOTHING`,
      [
        input.key,
        input.submission.contest_id,
        input.submission.contest_challenge_id,
        input.submission.participation_id,
        input.type,
        input.evidence,
        input.submission.submitted_at,
      ],
    )
  }

  private async advanceScoreboardVersion(
    connection: DatabaseExecutor,
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
    queryable: DatabaseExecutor,
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
    queryable: DatabaseExecutor,
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

  private async readCheatClue(
    queryable: DatabaseExecutor,
    contestId: string,
    clueId: string,
    forUpdate: boolean,
  ) {
    const result = await queryable.query<CheatClueRow>(
      `SELECT id, contest_id, contest_challenge_id, participation_id,
              clue_type, evidence, status::text, reviewed_by, review_note,
              reviewed_at, created_at, updated_at
       FROM cheat_clues
       WHERE contest_id = $1 AND id = $2
       ${forUpdate ? 'FOR UPDATE' : ''}`,
      [contestId, clueId],
    )
    return result.rows[0] ?? null
  }

  private async readCheatClueReviewByRequestId(
    queryable: DatabaseExecutor,
    requestId: string,
  ) {
    const result = await queryable.query<CheatClueReviewAuditRow>(
      `SELECT actor_user_id, target_id, reason, changes, occurred_at
       FROM audit_events
       WHERE request_id = $1
         AND action = 'cheat_clue.reviewed'
         AND target_type = 'cheat_clue'
       ORDER BY occurred_at, id
       LIMIT 1`,
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

function cheatClueRecord(row: CheatClueRow): CheatClueRecord {
  return {
    id: row.id,
    contestId: row.contest_id,
    challengeId: row.contest_challenge_id,
    participationId: row.participation_id,
    clueType: row.clue_type,
    evidence: row.evidence,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function reviewedCheatClueRecord(
  clue: CheatClueRow,
  audit: CheatClueReviewAuditRow,
  command: ReviewCheatClueCommand,
): CheatClueRecord {
  const finalReview = command.status === 'dismissed' || command.status === 'confirmed'
  return {
    ...cheatClueRecord(clue),
    status: command.status,
    reviewedBy: finalReview ? command.actorId : null,
    reviewNote: command.note,
    reviewedAt: finalReview ? audit.occurred_at : null,
    updatedAt: audit.occurred_at,
  }
}

function canReviewCheatClue(current: CheatClueStatus, next: ReviewCheatClueCommand['status']) {
  return current === 'open'
    ? ['reviewing', 'dismissed', 'confirmed'].includes(next)
    : current === 'reviewing' && ['dismissed', 'confirmed'].includes(next)
}

function sameCheatClueReview(
  audit: CheatClueReviewAuditRow,
  command: ReviewCheatClueCommand,
) {
  return audit.actor_user_id === command.actorId
    && audit.target_id === command.clueId
    && audit.changes.contest_id === command.contestId
    && audit.changes.to_status === command.status
    && (audit.changes.review_note ?? null) === command.note
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
