import type { Pool } from 'pg'
import { challengeFlagPolicySchema, type ChallengeFlagPolicy } from '../../../shared/contracts/challenges'
import {
  SubmissionChallengeClosedError,
  SubmissionChallengeUnavailableError,
  SubmissionContestNotRunningError,
  SubmissionLimitReachedError,
  SubmissionParticipationNotAcceptedError,
  SubmissionTeamRequiredError,
  type SubmissionAdmission,
  type SubmissionAdmissionCommand,
  type SubmissionRepository,
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

export class PostgresSubmissionRepository implements SubmissionRepository {
  constructor(private readonly pool: Pool) {}

  async admit(command: SubmissionAdmissionCommand): Promise<SubmissionAdmission> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
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

      const membership = await connection.query<{ team_id: string }>(
        `SELECT team_id
         FROM team_members
         WHERE user_id = $1
         FOR SHARE`,
        [command.userId],
      )
      const teamId = membership.rows[0]?.team_id
      if (!teamId) throw new SubmissionTeamRequiredError()

      const participationResult = await connection.query<ParticipationRow>(
        `SELECT id, status::text
         FROM participations
         WHERE contest_id = $1 AND team_id = $2
         FOR SHARE`,
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
         FOR SHARE`,
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

      const result = {
        contestId: command.contestId,
        challengeId: challenge.id,
        participationId: participation.id,
        teamId,
        flagFormat: challenge.flag_format,
        flagPolicy: challengeFlagPolicySchema.parse(challenge.flag_policy),
      }
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
}
