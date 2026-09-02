import {
  AnnouncementContestArchivedError,
  AnnouncementContestNotFoundError,
  AnnouncementNotFoundError,
  AnnouncementVersionConflictError,
  AnnouncementWithdrawnError,
  type AnnouncementPage,
  type AnnouncementRecord,
  type AnnouncementRepository,
  type AnnouncementStatus,
  type CreateAnnouncementCommand,
  type UpdateAnnouncementCommand,
  type WithdrawAnnouncementCommand,
} from '../../domains/announcements/repository'
import type { DatabaseExecutor } from './executor'

interface AnnouncementRow {
  id: string
  contest_id: string
  title: string
  body: string
  status: AnnouncementStatus
  publish_at: Date
  withdrawn_at: Date | null
  created_at: Date
  updated_at: Date
  version: string
}

interface LockedAnnouncementRow extends AnnouncementRow {
  database_now: Date
}

export class PostgresAnnouncementRepository implements AnnouncementRepository {
  constructor(private database: DatabaseExecutor) {}

  async create(command: CreateAnnouncementCommand): Promise<AnnouncementRecord> {
    return this.database.transaction(async (connection) => {
      await this.lockWritableContest(connection, command.contestId)
      await connection.query(
        `INSERT INTO announcements
           (id, contest_id, title, body, publish_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          command.announcementId,
          command.contestId,
          command.title,
          command.body,
          command.publishAt,
          command.actorId,
        ],
      )
      await this.writeAudit(connection, {
        actorId: command.actorId,
        requestId: command.requestId,
        contestId: command.contestId,
        announcementId: command.announcementId,
        action: 'contest.announcement.created',
        reason: '创建比赛公告',
        changes: {
          title: command.title,
          publish_at: command.publishAt.toISOString(),
        },
      })
      const result = await this.read(connection, command.contestId, command.announcementId)
      return result
    })
  }

  async readManaged(contestId: string, announcementId: string): Promise<AnnouncementRecord> {
    await this.requireContest(this.database, contestId, false)
    return this.read(this.database, contestId, announcementId)
  }

  async listManaged(contestId: string, cursor: string | undefined, limit: number): Promise<AnnouncementPage> {
    await this.requireContest(this.database, contestId, false)
    const result = await this.database.query<AnnouncementRow>(
      `${this.select()}
       WHERE a.contest_id = $1
         AND ($2::uuid IS NULL OR (a.created_at, a.id) < (
           SELECT cursor.created_at, cursor.id
           FROM announcements cursor
           WHERE cursor.contest_id = $1 AND cursor.id = $2
         ))
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $3`,
      [contestId, cursor ?? null, limit + 1],
    )
    return this.page(result.rows, limit)
  }

  async listPublic(contestId: string, cursor: string | undefined, limit: number): Promise<AnnouncementPage> {
    await this.requireContest(this.database, contestId, true)
    const result = await this.database.query<AnnouncementRow>(
      `${this.select()}
       WHERE a.contest_id = $1
         AND a.withdrawn_at IS NULL
         AND a.publish_at <= CURRENT_TIMESTAMP
         AND ($2::uuid IS NULL OR (a.publish_at, a.id) < (
           SELECT cursor.publish_at, cursor.id
           FROM announcements cursor
           WHERE cursor.contest_id = $1
             AND cursor.id = $2
             AND cursor.withdrawn_at IS NULL
             AND cursor.publish_at <= CURRENT_TIMESTAMP
         ))
       ORDER BY a.publish_at DESC, a.id DESC
       LIMIT $3`,
      [contestId, cursor ?? null, limit + 1],
    )
    return this.page(result.rows, limit)
  }

  async update(command: UpdateAnnouncementCommand): Promise<AnnouncementRecord> {
    return this.database.transaction(async (connection) => {
      await this.lockWritableContest(connection, command.contestId)
      const current = await this.lockAnnouncement(connection, command.contestId, command.announcementId)
      if (current.withdrawn_at) throw new AnnouncementWithdrawnError()
      if (Number(current.version) !== command.expectedVersion) throw new AnnouncementVersionConflictError()

      const nextVersion = command.expectedVersion + 1
      await connection.query(
        `UPDATE announcements
         SET title = $3,
             body = $4,
             publish_at = $5,
             version = version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE contest_id = $1 AND id = $2`,
        [command.contestId, command.announcementId, command.title, command.body, command.publishAt],
      )

      await this.writeAudit(connection, {
        actorId: command.actorId,
        requestId: command.requestId,
        contestId: command.contestId,
        announcementId: command.announcementId,
        action: 'contest.announcement.updated',
        reason: command.reason,
        changes: {
          title: command.title,
          body_changed: command.body !== current.body,
          publish_at: command.publishAt.toISOString(),
          version: nextVersion,
        },
      })
      const result = await this.read(connection, command.contestId, command.announcementId)
      return result
    })
  }

  async withdraw(command: WithdrawAnnouncementCommand): Promise<AnnouncementRecord> {
    return this.database.transaction(async (connection) => {
      await this.lockWritableContest(connection, command.contestId)
      const current = await this.lockAnnouncement(connection, command.contestId, command.announcementId)
      if (current.withdrawn_at) throw new AnnouncementWithdrawnError()
      if (Number(current.version) !== command.expectedVersion) throw new AnnouncementVersionConflictError()

      const nextVersion = command.expectedVersion + 1
      await connection.query(
        `UPDATE announcements
         SET withdrawn_at = CURRENT_TIMESTAMP,
             version = version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE contest_id = $1 AND id = $2`,
        [command.contestId, command.announcementId],
      )
      await this.writeAudit(connection, {
        actorId: command.actorId,
        requestId: command.requestId,
        contestId: command.contestId,
        announcementId: command.announcementId,
        action: 'contest.announcement.withdrawn',
        reason: command.reason,
        changes: { version: nextVersion },
      })
      const result = await this.read(connection, command.contestId, command.announcementId)
      return result
    })
  }

  private async lockWritableContest(connection: DatabaseExecutor, contestId: string) {
    const result = await connection.query<{ publication_status: 'draft' | 'published' | 'archived' }>(
      'SELECT publication_status::text FROM contests WHERE id = $1 FOR UPDATE',
      [contestId],
    )
    if (!result.rows[0]) throw new AnnouncementContestNotFoundError()
    if (result.rows[0].publication_status === 'archived') throw new AnnouncementContestArchivedError()
  }

  private async requireContest(
    connection: DatabaseExecutor,
    contestId: string,
    publicOnly: boolean,
  ) {
    const result = await connection.query(
      publicOnly
        ? `SELECT 1 FROM contests
           WHERE id = $1 AND visibility = 'public'
             AND publication_status IN ('published', 'archived')`
        : 'SELECT 1 FROM contests WHERE id = $1',
      [contestId],
    )
    if (!result.rows[0]) throw new AnnouncementContestNotFoundError()
  }

  private async lockAnnouncement(
    connection: DatabaseExecutor,
    contestId: string,
    announcementId: string,
  ): Promise<LockedAnnouncementRow> {
    const result = await connection.query<LockedAnnouncementRow>(
      `SELECT a.id, a.contest_id, a.title, a.body,
              CASE
                WHEN a.withdrawn_at IS NOT NULL THEN 'withdrawn'
                WHEN a.publish_at <= CURRENT_TIMESTAMP THEN 'published'
                ELSE 'scheduled'
              END::text AS status,
              a.publish_at, a.withdrawn_at, a.created_at, a.updated_at,
              a.version::text, CURRENT_TIMESTAMP AS database_now
       FROM announcements a
       WHERE a.contest_id = $1 AND a.id = $2
       FOR UPDATE`,
      [contestId, announcementId],
    )
    if (!result.rows[0]) throw new AnnouncementNotFoundError()
    return result.rows[0]
  }

  private async read(
    connection: DatabaseExecutor,
    contestId: string,
    announcementId: string,
  ): Promise<AnnouncementRecord> {
    const result = await connection.query<AnnouncementRow>(
      `${this.select()} WHERE a.contest_id = $1 AND a.id = $2`,
      [contestId, announcementId],
    )
    if (!result.rows[0]) throw new AnnouncementNotFoundError()
    return this.record(result.rows[0])
  }

  private select() {
    return `SELECT a.id, a.contest_id, a.title, a.body,
                   CASE
                     WHEN a.withdrawn_at IS NOT NULL THEN 'withdrawn'
                     WHEN a.publish_at <= CURRENT_TIMESTAMP THEN 'published'
                     ELSE 'scheduled'
                   END::text AS status,
                   a.publish_at, a.withdrawn_at, a.created_at, a.updated_at,
                   a.version::text
            FROM announcements a`
  }

  private page(rows: AnnouncementRow[], limit: number): AnnouncementPage {
    const hasMore = rows.length > limit
    const included = hasMore ? rows.slice(0, limit) : rows
    return {
      items: included.map(row => this.record(row)),
      nextCursor: hasMore ? included.at(-1)!.id : null,
      hasMore,
    }
  }

  private record(row: AnnouncementRow): AnnouncementRecord {
    return {
      id: row.id,
      contestId: row.contest_id,
      title: row.title,
      body: row.body,
      status: row.status,
      publishAt: row.publish_at,
      withdrawnAt: row.withdrawn_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: Number(row.version),
    }
  }

  private async writeAudit(connection: DatabaseExecutor, input: {
    actorId: string
    requestId: string
    contestId: string
    announcementId: string
    action: string
    reason: string
    changes: Record<string, unknown>
  }) {
    await connection.query(
      `INSERT INTO audit_events
         (actor_user_id, action, target_type, target_id, reason,
          outcome, request_id, changes, metadata)
       VALUES ($1, $2, 'announcement', $3, $4,
               'succeeded', $5, $6, $7)`,
      [
        input.actorId,
        input.action,
        input.announcementId,
        input.reason,
        input.requestId,
        input.changes,
        { contest_id: input.contestId },
      ],
    )
  }
}
