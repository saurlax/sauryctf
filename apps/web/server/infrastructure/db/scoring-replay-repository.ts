import type { Pool } from 'pg'
import { challengeScoringPolicySchema } from '../../../shared/contracts/challenges'
import {
  ScoringReplayContestNotFoundError,
  type ContestScoringFacts,
  type ReplayParticipationStatus,
  type ReplaySubmissionMode,
  type ReplaySubmissionResult,
  type ScoringReplayRepository,
} from '../../domains/submissions/scoring-replay'

interface ChallengeRow {
  id: string
  scoring_policy: unknown
}

interface ParticipationRow {
  id: string
  team_id: string
  team_name: string
  division_id: string | null
  status: ReplayParticipationStatus
}

interface SubmissionRow {
  id: string
  contest_challenge_id: string
  participation_id: string
  mode: ReplaySubmissionMode
  result: ReplaySubmissionResult
  submitted_at: Date
}

interface SolveRow {
  id: string
  submission_id: string
  contest_challenge_id: string
  participation_id: string
  mode: ReplaySubmissionMode
  solve_order: number
  solved_at: Date
}

interface AdjustmentRow {
  id: string
  participation_id: string
  points_delta: number
  created_at: Date
}

export class PostgresScoringReplayRepository implements ScoringReplayRepository {
  constructor(private readonly pool: Pool) {}

  async load(contestId: string): Promise<ContestScoringFacts> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const contest = await connection.query('SELECT 1 FROM contests WHERE id = $1', [contestId])
      if (!contest.rows[0]) throw new ScoringReplayContestNotFoundError()

      const challengeRows = await connection.query<ChallengeRow>(
        `SELECT id, scoring_policy
         FROM contest_challenges
         WHERE contest_id = $1
         ORDER BY id`,
        [contestId],
      )
      const participationRows = await connection.query<ParticipationRow>(
        `SELECT p.id, p.team_id, t.name AS team_name, p.division_id, p.status::text
         FROM participations p
         JOIN teams t ON t.id = p.team_id
         WHERE p.contest_id = $1
         ORDER BY p.id`,
        [contestId],
      )
      const submissionRows = await connection.query<SubmissionRow>(
        `SELECT id, contest_challenge_id, participation_id,
                mode::text, result::text, submitted_at
         FROM submissions
         WHERE contest_id = $1
         ORDER BY submitted_at, id`,
        [contestId],
      )
      const solveRows = await connection.query<SolveRow>(
        `SELECT id, submission_id, contest_challenge_id, participation_id,
                mode::text, solve_order, solved_at
         FROM solves
         WHERE contest_id = $1
         ORDER BY mode, contest_challenge_id, solve_order, solved_at, id`,
        [contestId],
      )
      const adjustmentRows = await connection.query<AdjustmentRow>(
        `SELECT id, participation_id, points_delta, created_at
         FROM score_adjustments
         WHERE contest_id = $1
         ORDER BY created_at, id`,
        [contestId],
      )
      await connection.query('COMMIT')

      return {
        challenges: challengeRows.rows.map(row => ({
          id: row.id,
          scoringPolicy: challengeScoringPolicySchema.parse(row.scoring_policy),
        })),
        participations: participationRows.rows.map(row => ({
          id: row.id,
          teamId: row.team_id,
          teamName: row.team_name,
          divisionId: row.division_id,
          status: row.status,
        })),
        submissions: submissionRows.rows.map(row => ({
          id: row.id,
          challengeId: row.contest_challenge_id,
          participationId: row.participation_id,
          mode: row.mode,
          result: row.result,
          submittedAt: row.submitted_at,
        })),
        solves: solveRows.rows.map(row => ({
          id: row.id,
          submissionId: row.submission_id,
          challengeId: row.contest_challenge_id,
          participationId: row.participation_id,
          mode: row.mode,
          solveOrder: row.solve_order,
          solvedAt: row.solved_at,
        })),
        adjustments: adjustmentRows.rows.map(row => ({
          id: row.id,
          participationId: row.participation_id,
          pointsDelta: row.points_delta,
          createdAt: row.created_at,
        })),
      }
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
  }
}
