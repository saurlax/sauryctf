import type { Pool, PoolClient } from 'pg'
import {
  ContestNotEndedError,
  ContestNotFoundError,
  ContestSlugConflictError,
  ContestTransitionInvalidError,
  ContestConfigurationLockedError,
  ContestVersionConflictError,
  type ContestLifecycleCommand,
  type ContestRecord,
  type ContestRepository,
  type CreateContestDraftCommand,
  type UpdateContestDraftCommand,
  type ContestPublicationStatus,
  type ContestTimePhase,
} from '../../domains/contests/repository'

interface ContestRow {
  id: string
  title: string
  slug: string
  description: string
  publication_status: ContestPublicationStatus
  phase: ContestTimePhase | null
  visibility: 'public' | 'private'
  invite_required: boolean
  invite_configured: boolean
  registration_strategy: 'review' | 'auto_accept'
  start_at: Date
  end_at: Date
  scoreboard_freeze_at: Date | null
  practice_enabled: boolean
  writeup_required: boolean
  writeup_deadline_at: Date | null
  min_team_size: number
  max_team_size: number
  registration_constraints: unknown
  published_at: Date | null
  archived_at: Date | null
  version: string
}

function isSlugConflict(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: string }).code === '23505'
    && (error as { constraint?: string }).constraint === 'contests_slug_unique'
}

export class PostgresContestRepository implements ContestRepository {
  constructor(private pool: Pool) {}

  async createDraft(command: CreateContestDraftCommand): Promise<ContestRecord> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const inserted = await connection.query<{ id: string }>(
        `INSERT INTO contests
           (title, slug, description, visibility, invite_required, invite_digest,
            registration_strategy, start_at, end_at, scoreboard_freeze_at,
            practice_enabled, writeup_required, writeup_deadline_at,
            min_team_size, max_team_size, registration_constraints, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14, $15, $16, $17)
         RETURNING id`,
        [
          command.title,
          command.slug,
          command.description,
          command.visibility,
          command.inviteRequired,
          command.inviteDigest,
          command.registrationStrategy,
          command.startAt,
          command.endAt,
          command.scoreboardFreezeAt,
          command.practiceEnabled,
          command.writeupRequired,
          command.writeupDeadlineAt,
          command.minTeamSize,
          command.maxTeamSize,
          { allowed_email_domains: command.registrationConstraints.allowedEmailDomains },
          command.actorId,
        ],
      )
      const contestId = inserted.rows[0]!.id
      await this.writeAudit(connection, command.actorId, command.requestId, contestId,
        'contest.created', '创建比赛草稿', {
          publication_status: 'draft',
          visibility: command.visibility,
          invite_required: command.inviteRequired,
          invite_configured: command.inviteDigest !== null,
          registration_strategy: command.registrationStrategy,
          practice_enabled: command.practiceEnabled,
          writeup_required: command.writeupRequired,
        })
      const result = await this.read(connection, contestId)
      await connection.query('COMMIT')
      return result
    }
    catch (error) {
      await connection.query('ROLLBACK')
      if (isSlugConflict(error)) throw new ContestSlugConflictError()
      throw error
    }
    finally {
      connection.release()
    }
  }

  async updateDraft(command: UpdateContestDraftCommand): Promise<ContestRecord> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const locked = await connection.query<{
        publication_status: ContestPublicationStatus
        version: string
      }>(
        `SELECT publication_status::text, version::text
         FROM contests WHERE id = $1 FOR UPDATE`,
        [command.contestId],
      )
      const current = locked.rows[0]
      if (!current) throw new ContestNotFoundError()
      if (current.publication_status !== 'draft') throw new ContestConfigurationLockedError()
      if (Number(current.version) !== command.expectedVersion) throw new ContestVersionConflictError()

      await connection.query(
        `UPDATE contests
         SET title = $2,
             slug = $3,
             description = $4,
             visibility = $5,
             invite_required = $6,
             invite_digest = CASE WHEN $7::boolean THEN $8::bytea ELSE invite_digest END,
             registration_strategy = $9,
             start_at = $10,
             end_at = $11,
             scoreboard_freeze_at = $12,
             practice_enabled = $13,
             writeup_required = $14,
             writeup_deadline_at = $15,
             min_team_size = $16,
             max_team_size = $17,
             registration_constraints = $18,
             version = version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [
          command.contestId,
          command.title,
          command.slug,
          command.description,
          command.visibility,
          command.inviteRequired,
          command.replaceInviteDigest,
          command.inviteDigest,
          command.registrationStrategy,
          command.startAt,
          command.endAt,
          command.scoreboardFreezeAt,
          command.practiceEnabled,
          command.writeupRequired,
          command.writeupDeadlineAt,
          command.minTeamSize,
          command.maxTeamSize,
          { allowed_email_domains: command.registrationConstraints.allowedEmailDomains },
        ],
      )
      await this.writeAudit(
        connection,
        command.actorId,
        command.requestId,
        command.contestId,
        'contest.configuration_updated',
        command.reason,
        {
          title: command.title,
          slug: command.slug,
          visibility: command.visibility,
          invite_required: command.inviteRequired,
          invite_replaced: command.replaceInviteDigest,
          registration_strategy: command.registrationStrategy,
          start_at: command.startAt.toISOString(),
          end_at: command.endAt.toISOString(),
          scoreboard_freeze_at: command.scoreboardFreezeAt?.toISOString() ?? null,
          practice_enabled: command.practiceEnabled,
          writeup_required: command.writeupRequired,
          writeup_deadline_at: command.writeupDeadlineAt?.toISOString() ?? null,
          min_team_size: command.minTeamSize,
          max_team_size: command.maxTeamSize,
          registration_constraints: { allowed_email_domains: command.registrationConstraints.allowedEmailDomains },
        },
      )
      const result = await this.read(connection, command.contestId)
      await connection.query('COMMIT')
      return result
    }
    catch (error) {
      await connection.query('ROLLBACK')
      if (isSlugConflict(error)) throw new ContestSlugConflictError()
      throw error
    }
    finally {
      connection.release()
    }
  }

  async readManaged(contestId: string): Promise<ContestRecord> {
    return this.read(this.pool, contestId)
  }

  async readPublic(contestId: string): Promise<ContestRecord> {
    const result = await this.pool.query<ContestRow>(
      `${this.select()} WHERE c.id = $1 AND c.visibility = 'public' AND c.publication_status IN ('published', 'archived')`,
      [contestId],
    )
    if (!result.rows[0]) throw new ContestNotFoundError()
    return this.record(result.rows[0])
  }

  async publish(command: ContestLifecycleCommand): Promise<ContestRecord> {
    return this.transition(command, 'published')
  }

  async archive(command: ContestLifecycleCommand): Promise<ContestRecord> {
    return this.transition(command, 'archived')
  }

  private async transition(
    command: ContestLifecycleCommand,
    target: 'published' | 'archived',
  ): Promise<ContestRecord> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const locked = await connection.query<{
        publication_status: ContestPublicationStatus
        phase: ContestTimePhase
      }>(
        `SELECT publication_status::text,
                derive_contest_time_phase(start_at, end_at, CURRENT_TIMESTAMP)::text AS phase
         FROM contests WHERE id = $1 FOR UPDATE`,
        [command.contestId],
      )
      const current = locked.rows[0]
      if (!current) throw new ContestNotFoundError()
      const expected = target === 'published' ? 'draft' : 'published'
      if (current.publication_status !== expected) throw new ContestTransitionInvalidError()
      if (target === 'archived' && current.phase !== 'ended') throw new ContestNotEndedError()

      if (target === 'published') {
        await connection.query(
          `UPDATE contests
           SET publication_status = 'published', published_at = CURRENT_TIMESTAMP,
               version = version + 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [command.contestId],
        )
      }
      else {
        await connection.query(
          `UPDATE contests
           SET publication_status = 'archived', archived_at = CURRENT_TIMESTAMP,
               version = version + 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [command.contestId],
        )
      }
      await this.writeAudit(
        connection,
        command.actorId,
        command.requestId,
        command.contestId,
        target === 'published' ? 'contest.published' : 'contest.archived',
        command.reason,
        { publication_status: target },
      )
      const result = await this.read(connection, command.contestId)
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

  private select() {
    return `SELECT c.id, c.title, c.slug, c.description, c.publication_status::text,
                   CASE
                     WHEN c.publication_status = 'draft' THEN NULL
                     WHEN c.publication_status = 'archived' THEN 'ended'::contest_time_phase
                     ELSE derive_contest_time_phase(c.start_at, c.end_at, CURRENT_TIMESTAMP)
                   END::text AS phase,
                   c.visibility::text, c.invite_required,
                   (c.invite_digest IS NOT NULL) AS invite_configured,
                   c.registration_strategy::text,
                   c.start_at, c.end_at, c.scoreboard_freeze_at,
                   c.practice_enabled, c.writeup_required, c.writeup_deadline_at,
                   c.min_team_size, c.max_team_size, c.registration_constraints,
                   c.published_at, c.archived_at, c.version::text
            FROM contests c`
  }

  private async read(connection: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>, contestId: string) {
    const result = await connection.query<ContestRow>(`${this.select()} WHERE c.id = $1`, [contestId])
    if (!result.rows[0]) throw new ContestNotFoundError()
    return this.record(result.rows[0])
  }

  private record(row: ContestRow): ContestRecord {
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      description: row.description,
      publicationStatus: row.publication_status,
      phase: row.phase,
      visibility: row.visibility,
      inviteRequired: row.invite_required,
      inviteConfigured: row.invite_configured,
      registrationStrategy: row.registration_strategy,
      startAt: row.start_at,
      endAt: row.end_at,
      scoreboardFreezeAt: row.scoreboard_freeze_at,
      practiceEnabled: row.practice_enabled,
      writeupRequired: row.writeup_required,
      writeupDeadlineAt: row.writeup_deadline_at,
      minTeamSize: row.min_team_size,
      maxTeamSize: row.max_team_size,
      registrationConstraints: this.registrationConstraints(row.registration_constraints),
      publishedAt: row.published_at,
      archivedAt: row.archived_at,
      version: Number(row.version),
    }
  }

  private registrationConstraints(value: unknown): { allowedEmailDomains: string[] } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Contest registration constraints are invalid')
    }
    const domains = (value as { allowed_email_domains?: unknown }).allowed_email_domains
    if (!Array.isArray(domains) || domains.some(domain => typeof domain !== 'string')) {
      throw new TypeError('Contest allowed email domains are invalid')
    }
    return { allowedEmailDomains: domains }
  }

  private async writeAudit(
    connection: PoolClient,
    actorId: string,
    requestId: string,
    contestId: string,
    action: string,
    reason: string,
    changes: Record<string, unknown>,
  ) {
    await connection.query(
      `INSERT INTO audit_events
         (actor_user_id, action, target_type, target_id, reason, outcome, request_id, changes, metadata)
       VALUES ($1, $2, 'contest', $3, $4, 'succeeded', $5, $6, '{}')`,
      [actorId, action, contestId, reason, requestId, changes],
    )
  }
}
