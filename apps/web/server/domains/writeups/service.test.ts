import { createHash, randomUUID } from 'node:crypto'
import { PostgresTestClient as Client } from '../../test-support/postgres-database'
import { strFromU8, unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SessionSubject } from '../identity/repository'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { runPostgresTestMigrations } from '../../test-support/postgres-database'
import { PostgresWriteupRepository } from '../../infrastructure/db/writeup-repository'
import { ZipWriteupArchiveBuilder } from '../../infrastructure/content/writeup-zip'
import { WriteupService } from './service'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName() {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected database name')
  return `"${databaseName}"`
}

describeWithPostgres('versioned Writeup lifecycle', () => {
  let admin: Client
  let database: PostgresTestDatabase
  let repository: PostgresWriteupRepository
  let writeups: WriteupService
  let sequence = 0
  const storedObjects = new Map<string, Uint8Array>()

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createPostgresTestDatabase({ connectionString: url.toString(), maxConnections: 12 })
    await runPostgresTestMigrations(database)
    repository = new PostgresWriteupRepository(database.executor)
    writeups = new WriteupService(
      repository,
      new ZipWriteupArchiveBuilder({
        read: async storageKey => storedObjects.get(storageKey) ?? null,
      }),
      () => new Date('2026-09-02T12:00:00.000Z'),
    )
  })

  afterAll(async () => {
    if (database) await database.close()
    if (admin) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [databaseName],
      )
      await admin.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName()}`)
      await admin.end()
    }
  })

  async function user(role: SessionSubject['role'] = 'user'): Promise<SessionSubject> {
    sequence++
    const username = `WriteupUser${sequence}`
    const email = `writeup-${sequence}@example.test`
    const result = await database.executor.query<{ id: string }>(
      `INSERT INTO users
         (username, username_normalized, email, email_normalized, email_verified_at)
       VALUES ($1::varchar(64), lower($1::text)::varchar(64),
               $2::varchar(320), lower($2::text)::varchar(320), CURRENT_TIMESTAMP)
       RETURNING id`,
      [username, email],
    )
    await database.executor.query(
      'INSERT INTO user_roles (user_id, role) VALUES ($1, $2)',
      [result.rows[0]!.id, role],
    )
    return {
      userId: result.rows[0]!.id,
      username,
      email,
      emailVerified: true,
      status: 'active',
      role,
      sessionVersion: 1,
      mustChangePassword: false,
    }
  }

  async function fixture(options: {
    writeupRequired?: boolean
    deadline?: 'future' | 'past' | 'none'
    participationStatus?: 'accepted' | 'pending'
    additionalMember?: SessionSubject
  } = {}) {
    sequence++
    const captain = await user()
    const organizer = await user('organizer')
    const connection = await database.connect()
    let teamId: string
    try {
      await connection.query('BEGIN')
      const team = await connection.query<{ id: string }>(
        `INSERT INTO teams (name, name_normalized, created_by)
         VALUES ($1::varchar(80), lower($1::text)::varchar(80), $2)
         RETURNING id`,
        [`Writeup Team ${sequence}`, captain.userId],
      )
      teamId = team.rows[0]!.id
      await connection.query(
        `INSERT INTO team_members (team_id, user_id, role)
         VALUES ($1, $2, 'captain')`,
        [teamId, captain.userId],
      )
      if (options.additionalMember) {
        await connection.query(
          `INSERT INTO team_members (team_id, user_id, role)
           VALUES ($1, $2, 'member')`,
          [teamId, options.additionalMember.userId],
        )
      }
      await connection.query('COMMIT')
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
    const now = Date.now()
    const startAt = new Date(now - 72 * 60 * 60_000)
    const endAt = new Date(now - 48 * 60 * 60_000)
    const deadline = options.deadline === 'none'
      ? null
      : new Date(now + (options.deadline === 'past' ? -24 : 24) * 60 * 60_000)
    const required = options.writeupRequired ?? true
    const contest = await database.executor.query<{ id: string }>(
      `INSERT INTO contests (
         title, slug, publication_status, visibility,
         start_at, end_at, writeup_required, writeup_deadline_at,
         published_at, created_by
       ) VALUES (
         $1, $2, 'published', 'public', $3, $4, $5, $6,
         $3, $7
       ) RETURNING id`,
      [
        `Writeup Contest ${sequence}`,
        `writeup-contest-${sequence}`,
        startAt,
        endAt,
        required,
        required ? deadline : null,
        organizer.userId,
      ],
    )
    const status = options.participationStatus ?? 'accepted'
    const participation = await database.executor.query<{ id: string }>(
      status === 'accepted'
        ? `INSERT INTO participations (
             contest_id, team_id, status, registered_by, reviewed_by, reviewed_at
           ) VALUES ($1, $2, 'accepted', $3, $4, CURRENT_TIMESTAMP)
           RETURNING id`
        : `INSERT INTO participations (
             contest_id, team_id, status, registered_by
           ) VALUES ($1, $2, 'pending', $3)
           RETURNING id`,
      status === 'accepted'
        ? [contest.rows[0]!.id, teamId, captain.userId, organizer.userId]
        : [contest.rows[0]!.id, teamId, captain.userId],
    )
    return {
      captain,
      organizer,
      teamId,
      contestId: contest.rows[0]!.id,
      participationId: participation.rows[0]!.id,
    }
  }

  async function committedObject(owner: SessionSubject, filename: string, text: string) {
    const body = Buffer.from(text)
    const sha256 = createHash('sha256').update(body).digest()
    const storageKey = `temporary/writeup-${randomUUID()}`
    const result = await database.executor.query<{ id: string }>(
      `INSERT INTO content_objects (
         storage_key, sha256_digest, size_bytes, media_type,
         original_filename, status, created_by, committed_at
       ) VALUES ($1, $2, $3, 'text/plain', $4, 'committed', $5, CURRENT_TIMESTAMP)
       RETURNING id`,
      [storageKey, sha256, body.byteLength, filename, owner.userId],
    )
    storedObjects.set(storageKey, body)
    return { id: result.rows[0]!.id, storageKey, body }
  }

  it('appends immutable versions and submits the exact current version', async () => {
    const member = await user()
    const target = await fixture({ additionalMember: member })
    const attachment = await committedObject(target.captain, 'evidence.txt', 'version-one-evidence')
    await expect(writeups.readOwn(target.captain, target.contestId)).resolves.toMatchObject({
      writeupRequired: true,
      writeup: null,
    })

    const first = await writeups.saveOwn(target.captain, {
      contestId: target.contestId,
      expectedVersion: 0,
      body: 'Version one',
      attachmentIds: [attachment.id],
    })
    expect(first).toMatchObject({ status: 'draft', currentVersion: 1, version: 1 })
    const submitted = await writeups.submitOwn(member, {
      contestId: target.contestId,
      expectedVersion: first.version,
    })
    expect(submitted).toMatchObject({
      status: 'submitted', currentVersion: 1, submittedVersion: 1, version: 2,
    })

    const second = await writeups.saveOwn(member, {
      contestId: target.contestId,
      expectedVersion: submitted.version,
      body: 'Version two draft',
      attachmentIds: [],
    })
    expect(second).toMatchObject({
      status: 'submitted', currentVersion: 2, submittedVersion: 1, version: 3,
      current: { body: 'Version two draft' },
      submitted: { body: 'Version one' },
    })
    const resubmitted = await writeups.submitOwn(target.captain, {
      contestId: target.contestId,
      expectedVersion: second.version,
    })
    expect(resubmitted).toMatchObject({
      status: 'submitted', currentVersion: 2, submittedVersion: 2, version: 4,
    })
    const facts = await database.executor.query<{ version_number: number, body: string }>(
      `SELECT version_number, body FROM writeup_versions
       WHERE writeup_id = $1 ORDER BY version_number`,
      [first.id],
    )
    expect(facts.rows).toEqual([
      { version_number: 1, body: 'Version one' },
      { version_number: 2, body: 'Version two draft' },
    ])
  })

  it('serializes concurrent saves and creates only one next version', async () => {
    const member = await user()
    const target = await fixture({ additionalMember: member })
    const initial = await writeups.saveOwn(target.captain, {
      contestId: target.contestId,
      expectedVersion: 0,
      body: 'Initial',
      attachmentIds: [],
    })
    const results = await Promise.allSettled([
      writeups.saveOwn(target.captain, {
        contestId: target.contestId, expectedVersion: initial.version,
        body: 'Captain edit', attachmentIds: [],
      }),
      writeups.saveOwn(member, {
        contestId: target.contestId, expectedVersion: initial.version,
        body: 'Member edit', attachmentIds: [],
      }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: { code: 'resource.version_conflict' },
    })
    const count = await database.executor.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM writeup_versions WHERE writeup_id = $1',
      [initial.id],
    )
    expect(count.rows[0]!.count).toBe('2')
  })

  it('enforces accepted participation, required configuration, and the deadline', async () => {
    const target = await fixture()
    const saved = await writeups.saveOwn(target.captain, {
      contestId: target.contestId, expectedVersion: 0,
      body: 'On-time content', attachmentIds: [],
    })
    const submitted = await writeups.submitOwn(target.captain, {
      contestId: target.contestId, expectedVersion: saved.version,
    })
    await database.executor.query(
      `UPDATE contests
       SET writeup_deadline_at = CURRENT_TIMESTAMP - interval '1 second'
       WHERE id = $1`,
      [target.contestId],
    )
    await expect(writeups.saveOwn(target.captain, {
      contestId: target.contestId, expectedVersion: submitted.version,
      body: 'Late content', attachmentIds: [],
    })).rejects.toMatchObject({ code: 'writeup.deadline_passed' })
    await expect(writeups.submitOwn(target.captain, {
      contestId: target.contestId, expectedVersion: submitted.version,
    })).rejects.toMatchObject({ code: 'writeup.deadline_passed' })
    await expect(writeups.readOwn(target.captain, target.contestId)).resolves.toMatchObject({
      writeup: { currentVersion: 1, submittedVersion: 1, current: { body: 'On-time content' } },
    })

    const optional = await fixture({ writeupRequired: false, deadline: 'none' })
    await expect(writeups.readOwn(optional.captain, optional.contestId)).resolves.toMatchObject({
      writeupRequired: false,
      writeup: null,
    })
    await expect(writeups.saveOwn(optional.captain, {
      contestId: optional.contestId, expectedVersion: 0,
      body: 'Not requested', attachmentIds: [],
    })).rejects.toMatchObject({ code: 'writeup.not_required' })

    const pending = await fixture({ participationStatus: 'pending' })
    await expect(writeups.readOwn(pending.captain, pending.contestId))
      .rejects.toMatchObject({ code: 'writeup.not_found' })
  })

  it('allows judges to review and explicitly correct a submission after the deadline', async () => {
    const target = await fixture()
    const saved = await writeups.saveOwn(target.captain, {
      contestId: target.contestId, expectedVersion: 0,
      body: 'Submitted body', attachmentIds: [],
    })
    const submitted = await writeups.submitOwn(target.captain, {
      contestId: target.contestId, expectedVersion: saved.version,
    })
    await expect(writeups.review(target.organizer, {
      requestId: randomUUID(), contestId: target.contestId, writeupId: submitted.id,
      expectedVersion: submitted.version, decision: 'changes_requested', note: null,
    })).rejects.toMatchObject({ code: 'writeup.input_invalid' })
    await expect(writeups.review(target.captain, {
      requestId: randomUUID(), contestId: target.contestId, writeupId: submitted.id,
      expectedVersion: submitted.version, decision: 'approved', note: null,
    })).rejects.toMatchObject({ code: 'identity.capability_forbidden' })

    const approved = await writeups.review(target.organizer, {
      requestId: randomUUID(), contestId: target.contestId, writeupId: submitted.id,
      expectedVersion: submitted.version, decision: 'approved', note: 'Verified by the jury',
    })
    expect(approved).toMatchObject({ status: 'approved', version: 3 })
    await database.executor.query(
      `UPDATE contests SET writeup_deadline_at = CURRENT_TIMESTAMP - interval '1 second'
       WHERE id = $1`,
      [target.contestId],
    )
    const requestId = randomUUID()
    const corrected = await writeups.correct(target.organizer, {
      requestId,
      contestId: target.contestId,
      writeupId: approved.id,
      expectedVersion: approved.version,
      body: 'Authorized post-deadline correction',
      attachmentIds: [],
      reason: 'Remove an accidentally disclosed internal hostname',
    })
    expect(corrected).toMatchObject({
      status: 'submitted', currentVersion: 2, submittedVersion: 2, version: 4,
      reviewedBy: null, reviewedAt: null,
      submitted: { body: 'Authorized post-deadline correction' },
    })
    const audit = await database.executor.query<{
      action: string
      reason: string
      changes: { submitted_version: number }
    }>(
      `SELECT action, reason, changes FROM audit_events
       WHERE request_id = $1 AND target_id = $2`,
      [requestId, approved.id],
    )
    expect(audit.rows).toEqual([{
      action: 'writeup.corrected',
      reason: 'Remove an accidentally disclosed internal hostname',
      changes: expect.objectContaining({ submitted_version: 2 }),
    }])

    await database.executor.query(
      `UPDATE contests
       SET publication_status = 'archived', archived_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [target.contestId],
    )
    await expect(writeups.correct(target.organizer, {
      requestId: randomUUID(), contestId: target.contestId, writeupId: corrected.id,
      expectedVersion: corrected.version, body: 'Archived edit', attachmentIds: [],
      reason: 'Attempt correction after archive',
    })).rejects.toMatchObject({ code: 'writeup.contest_archived' })
  })

  it('rolls back versions and attachment references when correction audit insertion fails', async () => {
    const target = await fixture()
    const saved = await writeups.saveOwn(target.captain, {
      contestId: target.contestId, expectedVersion: 0,
      body: 'Original', attachmentIds: [],
    })
    const submitted = await writeups.submitOwn(target.captain, {
      contestId: target.contestId, expectedVersion: saved.version,
    })
    const attachment = await committedObject(target.organizer, 'correction.txt', 'correction attachment')
    const requestId = randomUUID()
    await database.executor.query(
      `INSERT INTO audit_events (
         actor_user_id, action, target_type, target_id, reason,
         outcome, request_id, changes, metadata
       ) VALUES ($1, 'writeup.corrected', 'writeup', $2, 'Existing event',
                 'succeeded', $3, '{}', '{}')`,
      [target.organizer.userId, submitted.id, requestId],
    )
    await expect(writeups.correct(target.organizer, {
      requestId,
      contestId: target.contestId,
      writeupId: submitted.id,
      expectedVersion: submitted.version,
      body: 'Must roll back',
      attachmentIds: [attachment.id],
      reason: 'Trigger duplicate audit rollback',
    })).rejects.toMatchObject({ code: '23505' })
    const facts = await database.executor.query<{
      aggregate_version: string
      current_version: number
      versions: string
      references: string
    }>(
      `SELECT w.version::text AS aggregate_version,
              w.current_version,
              (SELECT count(*)::text FROM writeup_versions v WHERE v.writeup_id = w.id) AS versions,
              (SELECT count(*)::text
               FROM content_references r
               JOIN writeup_versions v ON v.id = r.writeup_version_id
               WHERE v.writeup_id = w.id) AS references
       FROM writeups w WHERE w.id = $1`,
      [submitted.id],
    )
    expect(facts.rows[0]).toEqual({
      aggregate_version: '2', current_version: 1, versions: '1', references: '0',
    })
  })

  it('exports only submitted versions with verified, path-safe attachments', async () => {
    const submittedTarget = await fixture()
    const attachment = await committedObject(
      submittedTarget.captain,
      '../../proof.txt',
      'verified attachment body',
    )
    const versionOne = await writeups.saveOwn(submittedTarget.captain, {
      contestId: submittedTarget.contestId,
      expectedVersion: 0,
      body: 'Official submitted version',
      attachmentIds: [attachment.id],
    })
    const submitted = await writeups.submitOwn(submittedTarget.captain, {
      contestId: submittedTarget.contestId,
      expectedVersion: versionOne.version,
    })
    await writeups.saveOwn(submittedTarget.captain, {
      contestId: submittedTarget.contestId,
      expectedVersion: submitted.version,
      body: 'Unsubmitted private draft',
      attachmentIds: [],
    })

    const draftCaptain = await user()
    const draftConnection = await database.connect()
    let draftTeamId: string
    try {
      await draftConnection.query('BEGIN')
      const draftTeam = await draftConnection.query<{ id: string }>(
        `INSERT INTO teams (name, name_normalized, created_by)
         VALUES ($1::varchar(80), lower($1::text)::varchar(80), $2) RETURNING id`,
        [`Draft Export Team ${sequence}`, draftCaptain.userId],
      )
      draftTeamId = draftTeam.rows[0]!.id
      await draftConnection.query(
        `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'captain')`,
        [draftTeamId, draftCaptain.userId],
      )
      await draftConnection.query('COMMIT')
    }
    catch (error) {
      await draftConnection.query('ROLLBACK')
      throw error
    }
    finally {
      draftConnection.release()
    }
    const draftParticipation = await database.executor.query<{ id: string }>(
      `INSERT INTO participations (
         contest_id, team_id, status, registered_by, reviewed_by, reviewed_at
       ) VALUES ($1, $2, 'accepted', $3, $4, CURRENT_TIMESTAMP)
       RETURNING id`,
      [
        submittedTarget.contestId,
        draftTeamId,
        draftCaptain.userId,
        submittedTarget.organizer.userId,
      ],
    )
    await database.executor.query(
      `WITH created AS (
         INSERT INTO writeups (contest_id, participation_id)
         VALUES ($1, $2) RETURNING id
       ), version AS (
         INSERT INTO writeup_versions (writeup_id, version_number, body, created_by)
         SELECT id, 1, 'Draft team private content', $3 FROM created
         RETURNING writeup_id
       )
       UPDATE writeups SET current_version = 1
       WHERE id = (SELECT writeup_id FROM version)`,
      [submittedTarget.contestId, draftParticipation.rows[0]!.id, draftCaptain.userId],
    )

    const archive = await writeups.exportSubmitted(
      submittedTarget.organizer,
      submittedTarget.contestId,
    )
    const files = unzipSync(archive.body)
    const paths = Object.keys(files)
    expect(paths).toContain('manifest.json')
    expect(paths.every(path => !path.includes('..') && !path.startsWith('/'))).toBe(true)
    const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as {
      format: string
      writeups: Array<{
        submitted_version: number
        body_path: string
        attachments: Array<{ path: string }>
      }>
    }
    expect(manifest.format).toBe('sauryctf.writeups.v1')
    expect(manifest.writeups).toHaveLength(1)
    expect(manifest.writeups[0]!.submitted_version).toBe(1)
    expect(strFromU8(files[manifest.writeups[0]!.body_path]!)).toBe('Official submitted version')
    expect(strFromU8(files[manifest.writeups[0]!.attachments[0]!.path]!)).toBe('verified attachment body')
    expect(Object.values(files).map(value => strFromU8(value)).join('\n'))
      .not.toContain('Unsubmitted private draft')
    expect(Object.values(files).map(value => strFromU8(value)).join('\n'))
      .not.toContain('Draft team private content')

    await expect(writeups.exportSubmitted(submittedTarget.captain, submittedTarget.contestId))
      .rejects.toMatchObject({ code: 'identity.capability_forbidden' })
    storedObjects.delete(attachment.storageKey)
    await expect(writeups.exportSubmitted(submittedTarget.organizer, submittedTarget.contestId))
      .rejects.toMatchObject({ code: 'writeup.export_content_unavailable' })
  })
})
