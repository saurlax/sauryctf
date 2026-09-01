import { randomBytes, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabaseClient, type DatabaseClient } from './client'
import { runMigrations } from './migrate'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName(): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected test database name')
  return `"${databaseName}"`
}

describeWithPostgres('content, writeup, transfer, settings, and audit authority schema', () => {
  let admin: Client
  let database: DatabaseClient
  let organizerId: string
  let contestId: string
  let participationId: string

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 4 })
    await runMigrations(database)

    const organizer = await database.pool.query<{ id: string }>(
      `INSERT INTO users (username, username_normalized, email, email_normalized)
       VALUES ('ContentOrganizer', 'contentorganizer', 'content@example.test', 'content@example.test')
       RETURNING id`,
    )
    organizerId = organizer.rows[0]!.id

    const connection = await database.pool.connect()
    let teamId: string
    try {
      await connection.query('BEGIN')
      const team = await connection.query<{ id: string }>(
        `INSERT INTO teams (name, name_normalized, created_by)
         VALUES ('Content Team', $1, $2) RETURNING id`,
        [`content-team-${randomUUID()}`, organizerId],
      )
      teamId = team.rows[0]!.id
      await connection.query(
        `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'captain')`,
        [teamId, organizerId],
      )
      await connection.query('COMMIT')
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
    const contest = await database.pool.query<{ id: string }>(
      `INSERT INTO contests (title, slug, start_at, end_at, created_by)
       VALUES ('Content Contest', $1, now() + interval '1 day', now() + interval '2 days', $2)
       RETURNING id`,
      [`content-${randomUUID()}`, organizerId],
    )
    contestId = contest.rows[0]!.id
    const participation = await database.pool.query<{ id: string }>(
      `INSERT INTO participations (contest_id, team_id, status, registered_by)
       VALUES ($1, $2, 'pending', $3) RETURNING id`,
      [contestId, teamId, organizerId],
    )
    participationId = participation.rows[0]!.id
  })

  afterAll(async () => {
    if (database) await database.pool.end()
    if (admin) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [databaseName],
      )
      await admin.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName()}`)
      await admin.end()
    }
  })

  async function createContentObject(status: 'temporary' | 'committed' = 'committed'): Promise<string> {
    const object = await database.pool.query<{ id: string }>(
      `INSERT INTO content_objects
         (storage_key, sha256_digest, size_bytes, media_type, original_filename, status, created_by, committed_at)
       VALUES ($1, $2, 32, 'application/octet-stream', 'artifact.bin', $3::content_object_status, $4,
         CASE WHEN $3::content_object_status = 'committed' THEN now() ELSE NULL END)
       RETURNING id`,
      [`objects/${randomUUID()}`, randomBytes(32), status, organizerId],
    )
    return object.rows[0]!.id
  }

  async function createWriteupVersion(): Promise<{ writeupId: string, versionId: string, versionNumber: number }> {
    const writeup = await database.pool.query<{ id: string, current_version: number | null }>(
      `INSERT INTO writeups (contest_id, participation_id)
       VALUES ($1, $2)
       ON CONFLICT (contest_id, participation_id)
       DO UPDATE SET updated_at = writeups.updated_at
       RETURNING id, current_version`,
      [contestId, participationId],
    )
    const writeupId = writeup.rows[0]!.id
    const versionNumber = (writeup.rows[0]!.current_version ?? 0) + 1
    const version = await database.pool.query<{ id: string }>(
      `INSERT INTO writeup_versions (writeup_id, version_number, body, created_by)
       VALUES ($1, $2, '# Writeup', $3) RETURNING id`,
      [writeupId, versionNumber, organizerId],
    )
    await database.pool.query('UPDATE writeups SET current_version = $2 WHERE id = $1', [writeupId, versionNumber])
    return { writeupId, versionId: version.rows[0]!.id, versionNumber }
  }

  it('keeps content identity immutable and accepts only canonical SHA-256 metadata', async () => {
    const objectId = await createContentObject()

    await expect(database.pool.query(
      `UPDATE content_objects SET storage_key = $2 WHERE id = $1`,
      [objectId, `objects/${randomUUID()}`],
    )).rejects.toMatchObject({ code: '55000' })

    await expect(database.pool.query(
      `INSERT INTO content_objects
         (storage_key, sha256_digest, size_bytes, media_type, original_filename, created_by)
       VALUES ($1, $2, 1, 'application/octet-stream', 'bad.bin', $3)`,
      [`objects/${randomUUID()}`, Buffer.from('not-a-sha256'), organizerId],
    )).rejects.toMatchObject({ code: '23514' })
  })

  it('enforces typed content ownership and committed-object references', async () => {
    const committedObjectId = await createContentObject()
    const temporaryObjectId = await createContentObject('temporary')
    const { versionId } = await createWriteupVersion()

    await database.pool.query(
      `INSERT INTO content_references (content_object_id, reference_type, writeup_version_id)
       VALUES ($1, 'writeup_attachment', $2)`,
      [committedObjectId, versionId],
    )

    await expect(database.pool.query(
      `INSERT INTO content_references (content_object_id, reference_type, writeup_version_id)
       VALUES ($1, 'challenge_attachment', $2)`,
      [committedObjectId, versionId],
    )).rejects.toMatchObject({ code: '23514' })

    await expect(database.pool.query(
      `INSERT INTO content_references (content_object_id, reference_type, writeup_version_id)
       VALUES ($1, 'writeup_attachment', $2)`,
      [temporaryObjectId, versionId],
    )).rejects.toMatchObject({ code: '23514' })
  })

  it('keeps writeup versions, public timeline events, and audit events append-only', async () => {
    const { writeupId, versionId, versionNumber } = await createWriteupVersion()

    await expect(database.pool.query(
      'UPDATE writeup_versions SET body = $2 WHERE id = $1',
      [versionId, 'mutated'],
    )).rejects.toMatchObject({ code: '55000' })
    await expect(database.pool.query(
      'DELETE FROM writeup_versions WHERE id = $1',
      [versionId],
    )).rejects.toMatchObject({ code: '55000' })

    const versionForeignKeys = await database.pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'public.writeups'::regclass
         AND conname IN ('writeups_current_version_fk', 'writeups_submitted_version_fk')
       ORDER BY conname`,
    )
    expect(versionForeignKeys.rows.map(row => row.conname)).toEqual([
      'writeups_current_version_fk',
      'writeups_submitted_version_fk',
    ])
    await expect(database.pool.query(
      'UPDATE writeups SET status = $2, submitted_version = $3, submitted_at = now() WHERE id = $1',
      [writeupId, 'submitted', versionNumber + 1],
    )).rejects.toMatchObject({ code: '23514' })

    const timeline = await database.pool.query<{ id: string }>(
      `INSERT INTO contest_events (contest_id, event_type, event_key)
       VALUES ($1, 'contest_phase_changed', $2) RETURNING id`,
      [contestId, `phase-${randomUUID()}`],
    )
    await expect(database.pool.query(
      `DELETE FROM contest_events WHERE id = $1`,
      [timeline.rows[0]!.id],
    )).rejects.toMatchObject({ code: '55000' })

    const requestId = randomUUID()
    const audit = await database.pool.query<{ id: string }>(
      `INSERT INTO audit_events
         (actor_user_id, action, target_type, target_id, outcome, request_id, changes, metadata)
       VALUES ($1, 'contest.update', 'contest', $2, 'succeeded', $3, '{}', '{}') RETURNING id`,
      [organizerId, contestId, requestId],
    )
    await expect(database.pool.query(
      `UPDATE audit_events SET reason = 'rewritten' WHERE id = $1`,
      [audit.rows[0]!.id],
    )).rejects.toMatchObject({ code: '55000' })
    await expect(database.pool.query(
      `DELETE FROM audit_events WHERE id = $1`,
      [audit.rows[0]!.id],
    )).rejects.toMatchObject({ code: '55000' })
    await expect(database.pool.query(
      `INSERT INTO audit_events
         (actor_user_id, action, target_type, target_id, outcome, request_id)
       VALUES ($1, 'contest.update', 'contest', $2, 'succeeded', $3)`,
      [organizerId, contestId, requestId],
    )).rejects.toMatchObject({ code: '23505' })
  })

  it('rejects unimplemented or secret-shaped platform settings', async () => {
    await database.pool.query(
      'INSERT INTO platform_settings DEFAULT VALUES ON CONFLICT (singleton) DO NOTHING',
    )

    await expect(database.pool.query(
      `UPDATE platform_settings SET authentication_mode = 'oidc_only' WHERE singleton = true`,
    )).rejects.toMatchObject({ code: '22P02' })
    await expect(database.pool.query(
      `UPDATE platform_settings SET theme = 'unknown' WHERE singleton = true`,
    )).rejects.toMatchObject({ code: '22P02' })
    await expect(database.pool.query(
      `UPDATE platform_settings SET brand_name = '   ' WHERE singleton = true`,
    )).rejects.toMatchObject({ code: '23514' })
    await expect(database.pool.query(
      `INSERT INTO platform_settings (singleton) VALUES (false)`,
    )).rejects.toMatchObject({ code: '23514' })

    const columns = await database.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'platform_settings'`,
    )
    expect(columns.rows.map(row => row.column_name)).not.toEqual(expect.arrayContaining([
      'session_secret',
      'database_url',
      'redis_url',
      's3_secret_access_key',
      'worker_credential',
    ]))
  })

  it('enforces atomic import and export terminal-state shapes', async () => {
    const packageObjectId = await createContentObject()
    const temporaryObjectId = await createContentObject('temporary')

    await database.pool.query(
      `INSERT INTO imports (package_object_id, package_version, idempotency_key, requested_by)
       VALUES ($1, 'sauryctf.jeopardy.v1', $2, $3)`,
      [packageObjectId, `import-${randomUUID()}`, organizerId],
    )
    await expect(database.pool.query(
      `INSERT INTO imports (package_object_id, package_version, idempotency_key, requested_by, status, finished_at)
       VALUES ($1, 'sauryctf.jeopardy.v1', $2, $3, 'queued', now())`,
      [packageObjectId, `import-${randomUUID()}`, organizerId],
    )).rejects.toMatchObject({ code: '23514' })
    await expect(database.pool.query(
      `INSERT INTO imports (package_object_id, package_version, idempotency_key, requested_by)
       VALUES ($1, 'sauryctf.jeopardy.v1', $2, $3)`,
      [temporaryObjectId, `import-${randomUUID()}`, organizerId],
    )).rejects.toMatchObject({ code: '23514' })

    const exportRow = await database.pool.query<{ id: string }>(
      `INSERT INTO exports (contest_id, package_version, idempotency_key, requested_by)
       VALUES ($1, 'sauryctf.jeopardy.v1', $2, $3) RETURNING id`,
      [contestId, `export-${randomUUID()}`, organizerId],
    )
    await database.pool.query(
      `UPDATE exports SET status = 'succeeded', package_object_id = $2, finished_at = now()
       WHERE id = $1`,
      [exportRow.rows[0]!.id, packageObjectId],
    )
    await expect(database.pool.query(
      `INSERT INTO exports (contest_id, package_version, idempotency_key, requested_by, status, finished_at)
       VALUES ($1, 'sauryctf.jeopardy.v1', $2, $3, 'failed', now())`,
      [contestId, `export-${randomUUID()}`, organizerId],
    )).rejects.toMatchObject({ code: '23514' })
  })
})
