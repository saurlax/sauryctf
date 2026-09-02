import {
  WriteupAttachmentUnavailableError,
  WriteupContestArchivedError,
  WriteupCurrentVersionMissingError,
  WriteupDeadlinePassedError,
  WriteupNoChangesToSubmitError,
  WriteupNotFoundError,
  WriteupNotRequiredError,
  WriteupNotSubmittedError,
  WriteupVersionConflictError,
  type CorrectWriteupCommand,
  type ManagedWriteupPage,
  type OwnWriteupState,
  type ReviewWriteupCommand,
  type SaveOwnWriteupCommand,
  type SubmitOwnWriteupCommand,
  type WriteupAttachmentRecord,
  type WriteupExportAttachment,
  type WriteupExportEntry,
  type WriteupExportSnapshot,
  type WriteupRecord,
  type WriteupRepository,
  type WriteupStatus,
  type WriteupVersionRecord,
} from '../../domains/writeups/repository'
import type { DatabaseExecutor } from './executor'

type Queryable = Pick<DatabaseExecutor, 'query'>

interface OwnContextRow {
  contest_id: string
  writeup_required: boolean
  writeup_deadline_at: Date | null
  publication_status: 'draft' | 'published' | 'archived'
  database_now: Date
  participation_id: string
}

interface WriteupRow {
  id: string
  contest_id: string
  participation_id: string
  team_id: string
  team_name: string
  status: WriteupStatus
  current_version: number | null
  submitted_version: number | null
  submitted_at: Date | null
  reviewed_by: string | null
  review_note: string | null
  reviewed_at: Date | null
  version: string
  updated_at: Date
}

interface WriteupVersionRow {
  id: string
  writeup_id: string
  version_number: number
  body: string
  created_by: string
  created_at: Date
}

interface WriteupAttachmentRow {
  reference_id: string
  writeup_version_id: string
  content_object_id: string
  storage_key: string
  filename: string
  media_type: string
  size_bytes: string
  sha256_digest: Buffer
  status: 'temporary' | 'committed' | 'quarantined' | 'deleted'
}

interface ExportWriteupRow {
  writeup_id: string
  participation_id: string
  team_id: string
  team_name: string
  version_id: string
  version_number: number
  body: string
  submitted_at: Date
}

export class PostgresWriteupRepository implements WriteupRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async readOwn(actorId: string, contestId: string): Promise<OwnWriteupState> {
    const context = await this.ownContext(this.database, actorId, contestId, false)
    const result = await this.database.query<{ id: string }>(
      `SELECT id
       FROM writeups
       WHERE contest_id = $1 AND participation_id = $2`,
      [contestId, context.participation_id],
    )
    return {
      contestId,
      writeupRequired: context.writeup_required,
      writeupDeadlineAt: context.writeup_deadline_at,
      writeup: result.rows[0]
        ? await this.loadRecord(this.database, contestId, result.rows[0].id)
        : null,
    }
  }

  async saveOwn(command: SaveOwnWriteupCommand): Promise<WriteupRecord> {
    return this.database.transaction(async (connection) => {
      const context = await this.ownContext(connection, command.actorId, command.contestId, true)
      this.requireWritableOwnContext(context)
      await this.requireAttachments(connection, command.attachmentIds)

      const locked = await connection.query<WriteupRow>(
        `${this.writeupSelect()}
         WHERE w.contest_id = $1 AND w.participation_id = $2
         FOR UPDATE OF w`,
        [command.contestId, context.participation_id],
      )
      const current = locked.rows[0]
      let writeupId: string
      let nextVersion: number
      if (!current) {
        if (command.expectedVersion !== 0) throw new WriteupVersionConflictError()
        const inserted = await connection.query<{ id: string }>(
          `INSERT INTO writeups (contest_id, participation_id)
           VALUES ($1, $2)
           RETURNING id`,
          [command.contestId, context.participation_id],
        )
        writeupId = inserted.rows[0]!.id
        nextVersion = 1
      }
      else {
        if (Number(current.version) !== command.expectedVersion) throw new WriteupVersionConflictError()
        writeupId = current.id
        nextVersion = (current.current_version ?? 0) + 1
      }

      const version = await connection.query<{ id: string }>(
        `INSERT INTO writeup_versions
           (writeup_id, version_number, body, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [writeupId, nextVersion, command.body, command.actorId],
      )
      await this.insertAttachmentReferences(connection, version.rows[0]!.id, command.attachmentIds)
      await connection.query(
        current
          ? `UPDATE writeups
             SET current_version = $2,
                 version = version + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`
          : `UPDATE writeups
             SET current_version = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
        [writeupId, nextVersion],
      )
      const record = await this.loadRecord(connection, command.contestId, writeupId)
      return record
    })
  }

  async submitOwn(command: SubmitOwnWriteupCommand): Promise<WriteupRecord> {
    return this.database.transaction(async (connection) => {
      const context = await this.ownContext(connection, command.actorId, command.contestId, true)
      this.requireWritableOwnContext(context)
      const result = await connection.query<WriteupRow>(
        `${this.writeupSelect()}
         WHERE w.contest_id = $1 AND w.participation_id = $2
         FOR UPDATE OF w`,
        [command.contestId, context.participation_id],
      )
      const current = result.rows[0]
      if (!current || current.current_version === null) throw new WriteupCurrentVersionMissingError()
      if (Number(current.version) !== command.expectedVersion) throw new WriteupVersionConflictError()
      if (current.submitted_version === current.current_version) throw new WriteupNoChangesToSubmitError()

      await connection.query(
        `UPDATE writeups
         SET status = 'submitted',
             submitted_version = current_version,
             submitted_at = CURRENT_TIMESTAMP,
             reviewed_by = NULL,
             review_note = NULL,
             reviewed_at = NULL,
             version = version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [current.id],
      )
      const record = await this.loadRecord(connection, command.contestId, current.id)
      return record
    })
  }

  async listManaged(
    contestId: string,
    status: WriteupStatus | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<ManagedWriteupPage> {
    await this.requireContest(this.database, contestId, false)
    const result = await this.database.query<{ id: string }>(
      `SELECT w.id
       FROM writeups w
       WHERE w.contest_id = $1
         AND w.current_version IS NOT NULL
         AND ($2::writeup_status IS NULL OR w.status = $2)
         AND ($3::uuid IS NULL OR (w.updated_at, w.id) < (
           SELECT cursor.updated_at, cursor.id
           FROM writeups cursor
           WHERE cursor.contest_id = $1 AND cursor.id = $3
         ))
       ORDER BY w.updated_at DESC, w.id DESC
       LIMIT $4`,
      [contestId, status ?? null, cursor ?? null, limit + 1],
    )
    const hasMore = result.rows.length > limit
    const selected = result.rows.slice(0, limit)
    const items: WriteupRecord[] = []
    for (const row of selected) items.push(await this.loadRecord(this.database, contestId, row.id))
    return {
      items,
      hasMore,
      nextCursor: hasMore ? selected.at(-1)?.id ?? null : null,
    }
  }

  async review(command: ReviewWriteupCommand): Promise<WriteupRecord> {
    return this.database.transaction(async (connection) => {
      await this.requireContest(connection, command.contestId, true)
      const current = await this.lockWriteup(connection, command.contestId, command.writeupId)
      if (Number(current.version) !== command.expectedVersion) throw new WriteupVersionConflictError()
      if (current.submitted_version === null || current.status === 'draft') throw new WriteupNotSubmittedError()

      await connection.query(
        `UPDATE writeups
         SET status = $2,
             reviewed_by = $3,
             review_note = $4,
             reviewed_at = CURRENT_TIMESTAMP,
             version = version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [current.id, command.decision, command.actorId, command.note],
      )
      await this.writeAudit(connection, {
        actorId: command.actorId,
        requestId: command.requestId,
        contestId: command.contestId,
        writeupId: command.writeupId,
        action: 'writeup.reviewed',
        reason: command.note ?? '审核通过 Writeup',
        changes: {
          previous_status: current.status,
          decision: command.decision,
          submitted_version: current.submitted_version,
        },
      })
      const record = await this.loadRecord(connection, command.contestId, command.writeupId)
      return record
    })
  }

  async correct(command: CorrectWriteupCommand): Promise<WriteupRecord> {
    return this.database.transaction(async (connection) => {
      await this.requireContest(connection, command.contestId, true)
      const current = await this.lockWriteup(connection, command.contestId, command.writeupId)
      if (Number(current.version) !== command.expectedVersion) throw new WriteupVersionConflictError()
      if (current.current_version === null) throw new WriteupCurrentVersionMissingError()
      await this.requireAttachments(connection, command.attachmentIds)

      const nextVersion = current.current_version + 1
      const version = await connection.query<{ id: string }>(
        `INSERT INTO writeup_versions
           (writeup_id, version_number, body, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [current.id, nextVersion, command.body, command.actorId],
      )
      await this.insertAttachmentReferences(connection, version.rows[0]!.id, command.attachmentIds)
      await connection.query(
        `UPDATE writeups
         SET current_version = $2::integer,
             status = CASE WHEN submitted_version IS NULL THEN 'draft'::writeup_status ELSE 'submitted'::writeup_status END,
             submitted_version = CASE WHEN submitted_version IS NULL THEN NULL ELSE $2::integer END,
             reviewed_by = NULL,
             review_note = NULL,
             reviewed_at = NULL,
             version = version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [current.id, nextVersion],
      )
      await this.writeAudit(connection, {
        actorId: command.actorId,
        requestId: command.requestId,
        contestId: command.contestId,
        writeupId: command.writeupId,
        action: 'writeup.corrected',
        reason: command.reason,
        changes: {
          previous_current_version: current.current_version,
          previous_submitted_version: current.submitted_version,
          current_version: nextVersion,
          submitted_version: current.submitted_version === null ? null : nextVersion,
          attachment_count: command.attachmentIds.length,
        },
      })
      const record = await this.loadRecord(connection, command.contestId, command.writeupId)
      return record
    })
  }

  async exportSubmitted(contestId: string): Promise<WriteupExportSnapshot> {
    const contest = await this.database.query<{ title: string }>(
      'SELECT title FROM contests WHERE id = $1',
      [contestId],
    )
    if (!contest.rows[0]) throw new WriteupNotFoundError()
    const result = await this.database.query<ExportWriteupRow>(
      `SELECT w.id AS writeup_id,
              w.participation_id,
              p.team_id,
              t.name AS team_name,
              version.id AS version_id,
              version.version_number,
              version.body,
              w.submitted_at
       FROM writeups w
       JOIN participations p ON p.id = w.participation_id
       JOIN teams t ON t.id = p.team_id
       JOIN writeup_versions version
         ON version.writeup_id = w.id
        AND version.version_number = w.submitted_version
       WHERE w.contest_id = $1
         AND w.submitted_version IS NOT NULL
       ORDER BY t.name_normalized, t.id`,
      [contestId],
    )
    const attachmentRows = result.rows.length === 0
      ? []
      : (await this.database.query<WriteupAttachmentRow>(
          `${this.attachmentSelect()}
           AND reference.writeup_version_id = ANY($1::uuid[])
           ORDER BY reference.writeup_version_id, reference.created_at, reference.id`,
          [result.rows.map(row => row.version_id)],
        )).rows
    const unavailable = attachmentRows
      .filter(row => row.status !== 'committed')
      .map(row => row.content_object_id)
    if (unavailable.length > 0) throw new WriteupAttachmentUnavailableError(unavailable)
    const byVersion = new Map<string, WriteupExportAttachment[]>()
    for (const row of attachmentRows) {
      const list = byVersion.get(row.writeup_version_id) ?? []
      list.push(this.exportAttachment(row))
      byVersion.set(row.writeup_version_id, list)
    }
    return {
      contestId,
      contestTitle: contest.rows[0].title,
      entries: result.rows.map<WriteupExportEntry>(row => ({
        writeupId: row.writeup_id,
        participationId: row.participation_id,
        teamId: row.team_id,
        teamName: row.team_name,
        versionNumber: row.version_number,
        body: row.body,
        submittedAt: row.submitted_at,
        attachments: byVersion.get(row.version_id) ?? [],
      })),
    }
  }

  private async ownContext(
    connection: Queryable,
    actorId: string,
    contestId: string,
    lock: boolean,
  ): Promise<OwnContextRow> {
    const result = await connection.query<OwnContextRow>(
      `SELECT c.id AS contest_id,
              c.writeup_required,
              c.writeup_deadline_at,
              c.publication_status::text,
              CURRENT_TIMESTAMP AS database_now,
              p.id AS participation_id
       FROM contests c
       JOIN participations p
         ON p.contest_id = c.id AND p.status = 'accepted'
       JOIN team_members member
         ON member.team_id = p.team_id AND member.user_id = $1
       WHERE c.id = $2
       ${lock ? 'FOR UPDATE OF c, p' : ''}`,
      [actorId, contestId],
    )
    if (!result.rows[0]) throw new WriteupNotFoundError()
    return result.rows[0]
  }

  private requireWritableOwnContext(context: OwnContextRow) {
    if (!context.writeup_required) throw new WriteupNotRequiredError()
    if (context.publication_status === 'archived') throw new WriteupContestArchivedError()
    if (context.writeup_deadline_at
      && context.database_now.getTime() >= context.writeup_deadline_at.getTime()) {
      throw new WriteupDeadlinePassedError()
    }
  }

  private async requireContest(connection: Queryable, contestId: string, writable: boolean) {
    const result = await connection.query<{ publication_status: 'draft' | 'published' | 'archived' }>(
      `${writable
        ? 'SELECT publication_status::text FROM contests WHERE id = $1 FOR UPDATE'
        : 'SELECT publication_status::text FROM contests WHERE id = $1'}`,
      [contestId],
    )
    if (!result.rows[0]) throw new WriteupNotFoundError()
    if (writable && result.rows[0].publication_status === 'archived') {
      throw new WriteupContestArchivedError()
    }
  }

  private async lockWriteup(connection: DatabaseExecutor, contestId: string, writeupId: string) {
    const result = await connection.query<WriteupRow>(
      `${this.writeupSelect()}
       WHERE w.contest_id = $1 AND w.id = $2
       FOR UPDATE OF w`,
      [contestId, writeupId],
    )
    if (!result.rows[0]) throw new WriteupNotFoundError()
    return result.rows[0]
  }

  private async requireAttachments(connection: Queryable, contentObjectIds: string[]) {
    if (contentObjectIds.length === 0) return
    const result = await connection.query<{ id: string }>(
      `SELECT id
       FROM content_objects
       WHERE id = ANY($1::uuid[]) AND status = 'committed'`,
      [contentObjectIds],
    )
    const available = new Set(result.rows.map(row => row.id))
    const unavailable = contentObjectIds.filter(id => !available.has(id))
    if (unavailable.length > 0) throw new WriteupAttachmentUnavailableError(unavailable)
  }

  private async insertAttachmentReferences(
    connection: Queryable,
    writeupVersionId: string,
    contentObjectIds: string[],
  ) {
    if (contentObjectIds.length === 0) return
    await connection.query(
      `INSERT INTO content_references
         (content_object_id, reference_type, writeup_version_id)
       SELECT id, 'writeup_attachment', $2
       FROM unnest($1::uuid[]) AS input(id)`,
      [contentObjectIds, writeupVersionId],
    )
  }

  private async loadRecord(
    connection: Queryable,
    contestId: string,
    writeupId: string,
  ): Promise<WriteupRecord> {
    const result = await connection.query<WriteupRow>(
      `${this.writeupSelect()}
       WHERE w.contest_id = $1 AND w.id = $2`,
      [contestId, writeupId],
    )
    const row = result.rows[0]
    if (!row) throw new WriteupNotFoundError()
    if (row.current_version === null) throw new WriteupCurrentVersionMissingError()
    const versionNumbers = row.submitted_version === null || row.submitted_version === row.current_version
      ? [row.current_version]
      : [row.current_version, row.submitted_version]
    const versions = await connection.query<WriteupVersionRow>(
      `SELECT id, writeup_id, version_number, body, created_by, created_at
       FROM writeup_versions
       WHERE writeup_id = $1 AND version_number = ANY($2::integer[])`,
      [row.id, versionNumbers],
    )
    const attachments = versions.rows.length === 0
      ? []
      : (await connection.query<WriteupAttachmentRow>(
          `${this.attachmentSelect()}
           AND reference.writeup_version_id = ANY($1::uuid[])
           ORDER BY reference.created_at, reference.id`,
          [versions.rows.map(version => version.id)],
        )).rows
    const attachmentsByVersion = new Map<string, WriteupAttachmentRecord[]>()
    for (const attachment of attachments) {
      const list = attachmentsByVersion.get(attachment.writeup_version_id) ?? []
      list.push(this.attachment(attachment))
      attachmentsByVersion.set(attachment.writeup_version_id, list)
    }
    const byNumber = new Map<number, WriteupVersionRecord>()
    for (const version of versions.rows) {
      byNumber.set(version.version_number, {
        id: version.id,
        versionNumber: version.version_number,
        body: version.body,
        createdBy: version.created_by,
        createdAt: version.created_at,
        attachments: attachmentsByVersion.get(version.id) ?? [],
      })
    }
    const current = byNumber.get(row.current_version)
    if (!current) throw new WriteupCurrentVersionMissingError()
    const submitted = row.submitted_version === null ? null : byNumber.get(row.submitted_version)
    if (row.submitted_version !== null && !submitted) throw new WriteupNotSubmittedError()
    return {
      id: row.id,
      contestId: row.contest_id,
      participationId: row.participation_id,
      teamId: row.team_id,
      teamName: row.team_name,
      status: row.status,
      currentVersion: row.current_version,
      submittedVersion: row.submitted_version,
      submittedAt: row.submitted_at,
      reviewedBy: row.reviewed_by,
      reviewNote: row.review_note,
      reviewedAt: row.reviewed_at,
      version: Number(row.version),
      updatedAt: row.updated_at,
      current,
      submitted: submitted ?? null,
    }
  }

  private attachment(row: WriteupAttachmentRow): WriteupAttachmentRecord {
    return {
      referenceId: row.reference_id,
      contentObjectId: row.content_object_id,
      filename: row.filename,
      mediaType: row.media_type,
      sizeBytes: Number(row.size_bytes),
      sha256Hex: row.sha256_digest.toString('hex'),
    }
  }

  private exportAttachment(row: WriteupAttachmentRow): WriteupExportAttachment {
    return {
      ...this.attachment(row),
      storageKey: row.storage_key,
    }
  }

  private async writeAudit(connection: Queryable, input: {
    actorId: string
    requestId: string
    contestId: string
    writeupId: string
    action: string
    reason: string
    changes: Record<string, unknown>
  }) {
    await connection.query(
      `INSERT INTO audit_events
         (actor_user_id, action, target_type, target_id, reason,
          outcome, request_id, changes, metadata)
       VALUES ($1, $2, 'writeup', $3, $4, 'succeeded', $5, $6, $7)`,
      [
        input.actorId,
        input.action,
        input.writeupId,
        input.reason,
        input.requestId,
        input.changes,
        { contest_id: input.contestId },
      ],
    )
  }

  private writeupSelect() {
    return `SELECT w.id,
                   w.contest_id,
                   w.participation_id,
                   p.team_id,
                   t.name AS team_name,
                   w.status::text,
                   w.current_version,
                   w.submitted_version,
                   w.submitted_at,
                   w.reviewed_by,
                   w.review_note,
                   w.reviewed_at,
                   w.version,
                   w.updated_at
            FROM writeups w
            JOIN participations p ON p.id = w.participation_id
            JOIN teams t ON t.id = p.team_id`
  }

  private attachmentSelect() {
    return `SELECT reference.id AS reference_id,
                   reference.writeup_version_id,
                   object.id AS content_object_id,
                   object.storage_key,
                   object.original_filename AS filename,
                   object.media_type,
                   object.size_bytes,
                   object.sha256_digest,
                   object.status::text
            FROM content_references reference
            JOIN content_objects object ON object.id = reference.content_object_id
            WHERE reference.reference_type = 'writeup_attachment'`
  }
}
