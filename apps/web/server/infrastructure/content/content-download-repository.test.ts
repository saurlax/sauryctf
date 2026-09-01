import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabaseClient, type DatabaseClient } from '../db/client'
import { PostgresContentDownloadRepository } from '../db/content-download-repository'
import { runMigrations } from '../db/migrate'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName(): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected test database name')
  return `"${databaseName}"`
}

describeWithPostgres('PostgreSQL content download authorization', () => {
  let admin: Client
  let database: DatabaseClient
  let repository: PostgresContentDownloadRepository
  let ownerId: string
  let outsiderId: string
  let challengeAssetId: string
  let writeupReferenceId: string
  let challengeObjectId: string

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 4 })
    await runMigrations(database)
    repository = new PostgresContentDownloadRepository(database.pool)

    const owner = await createUser(database, 'DownloadOwner')
    const outsider = await createUser(database, 'DownloadOutsider')
    ownerId = owner
    outsiderId = outsider

    const connection = await database.pool.connect()
    try {
      await connection.query('BEGIN')
      const team = await connection.query<{ id: string }>(`
        INSERT INTO teams (name, name_normalized, created_by)
        VALUES ('Download Team', 'download team', $1)
        RETURNING id`, [ownerId])
      await connection.query(`
        INSERT INTO team_members (team_id, user_id, role)
        VALUES ($1, $2, 'captain')`, [team.rows[0]!.id, ownerId])
      const contest = await connection.query<{ id: string }>(`
        INSERT INTO contests (
          title, slug, visibility, start_at, end_at,
          writeup_required, writeup_deadline_at, created_by
        ) VALUES (
          'Private download contest', 'private-download-contest', 'private',
          '2026-09-02T07:00:00.000Z', '2026-09-02T10:00:00.000Z',
          true, '2026-09-03T00:00:00.000Z', $1
        ) RETURNING id`, [ownerId])
      const participation = await connection.query<{ id: string }>(`
        INSERT INTO participations (
          contest_id, team_id, status, registered_by, reviewed_by, reviewed_at
        ) VALUES ($1, $2, 'accepted', $3, $3, '2026-09-01T01:00:00.000Z')
        RETURNING id`, [contest.rows[0]!.id, team.rows[0]!.id, ownerId])
      const template = await connection.query<{ id: string }>(`
        INSERT INTO challenge_templates (name, slug, created_by, latest_version)
        VALUES ('Private attachment template', 'private-attachment-template', $1, 1)
        RETURNING id`, [ownerId])
      const templateVersion = await connection.query<{ id: string }>(`
        INSERT INTO challenge_template_versions (
          template_id, version_number, title, category, description,
          flag_policy, scoring_policy, instance_policy, created_by
        ) VALUES (
          $1, 1, 'Private attachment', 'misc', 'Private content',
          '{"type":"static","digest":"masked"}',
          '{"type":"fixed-v1","points":100}', '{"type":"none"}', $2
        ) RETURNING id`, [template.rows[0]!.id, ownerId])
      const challenge = await connection.query<{ id: string }>(`
        INSERT INTO contest_challenges (
          contest_id, source_template_id, source_version_id, title, category,
          description, flag_policy, scoring_policy, instance_policy,
          enabled, publish_at
        ) VALUES (
          $1, $2, $3, 'Private attachment', 'misc', 'Private content',
          '{"type":"static","digest":"masked"}',
          '{"type":"fixed-v1","points":100}', '{"type":"none"}',
          true, '2026-09-02T07:30:00.000Z'
        ) RETURNING id`, [contest.rows[0]!.id, template.rows[0]!.id, templateVersion.rows[0]!.id])
      const challengeObject = await connection.query<{ id: string }>(`
        INSERT INTO content_objects (
          storage_key, sha256_digest, size_bytes, media_type, original_filename,
          status, created_by, committed_at
        ) VALUES (
          'temporary/private-html', decode(repeat('11', 32), 'hex'), 12,
          'text/html', 'payload.html', 'committed', $1, '2026-09-01T00:00:00.000Z'
        ) RETURNING id`, [ownerId])
      challengeObjectId = challengeObject.rows[0]!.id
      const challengeAsset = await connection.query<{ id: string }>(`
        INSERT INTO challenge_assets (contest_challenge_id, content_object_id, display_name)
        VALUES ($1, $2, 'private-payload.html')
        RETURNING id`, [challenge.rows[0]!.id, challengeObjectId])
      challengeAssetId = challengeAsset.rows[0]!.id

      const writeup = await connection.query<{ id: string }>(`
        INSERT INTO writeups (contest_id, participation_id)
        VALUES ($1, $2) RETURNING id`, [contest.rows[0]!.id, participation.rows[0]!.id])
      const writeupVersion = await connection.query<{ id: string }>(`
        INSERT INTO writeup_versions (writeup_id, version_number, body, created_by)
        VALUES ($1, 1, 'Writeup body', $2) RETURNING id`, [writeup.rows[0]!.id, ownerId])
      await connection.query(
        'UPDATE writeups SET current_version = 1 WHERE id = $1',
        [writeup.rows[0]!.id],
      )
      const writeupObject = await connection.query<{ id: string }>(`
        INSERT INTO content_objects (
          storage_key, sha256_digest, size_bytes, media_type, original_filename,
          status, created_by, committed_at
        ) VALUES (
          'temporary/writeup-proof', decode(repeat('22', 32), 'hex'), 16,
          'image/png', 'proof.png', 'committed', $1, '2026-09-01T00:00:00.000Z'
        ) RETURNING id`, [ownerId])
      const reference = await connection.query<{ id: string }>(`
        INSERT INTO content_references (content_object_id, reference_type, writeup_version_id)
        VALUES ($1, 'writeup_attachment', $2) RETURNING id`, [writeupObject.rows[0]!.id, writeupVersion.rows[0]!.id])
      writeupReferenceId = reference.rows[0]!.id
      await connection.query(`
        UPDATE contests
        SET publication_status = 'published', published_at = '2026-09-01T00:00:00.000Z'
        WHERE id = $1`, [contest.rows[0]!.id])
      await connection.query('COMMIT')
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
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

  it('allows only accepted team members after a private challenge is released', async () => {
    const runningAt = new Date('2026-09-02T08:00:00.000Z')
    await expect(repository.findChallengeAsset(ownerId, false, challengeAssetId, runningAt))
      .resolves.toMatchObject({
        storageKey: 'temporary/private-html',
        mediaType: 'text/html',
        downloadFilename: 'private-payload.html',
      })
    await expect(repository.findChallengeAsset(outsiderId, false, challengeAssetId, runningAt))
      .resolves.toBeNull()
    await expect(repository.findChallengeAsset(
      ownerId,
      false,
      challengeAssetId,
      new Date('2026-09-02T07:15:00.000Z'),
    )).resolves.toBeNull()
  })

  it('allows a global organizer to inspect a private challenge before release', async () => {
    await expect(repository.findChallengeAsset(
      outsiderId,
      true,
      challengeAssetId,
      new Date('2026-09-01T08:00:00.000Z'),
    )).resolves.toMatchObject({ storageKey: 'temporary/private-html' })
  })

  it('limits Writeup attachments to the owning team and global judges', async () => {
    await expect(repository.findWriteupAttachment(ownerId, false, writeupReferenceId))
      .resolves.toMatchObject({ storageKey: 'temporary/writeup-proof', downloadFilename: 'proof.png' })
    await expect(repository.findWriteupAttachment(outsiderId, false, writeupReferenceId))
      .resolves.toBeNull()
    await expect(repository.findWriteupAttachment(outsiderId, true, writeupReferenceId))
      .resolves.toMatchObject({ storageKey: 'temporary/writeup-proof' })
  })

  it('does not authorize content that has entered quarantine', async () => {
    await database.pool.query(
      `UPDATE content_objects SET status = 'quarantined' WHERE id = $1`,
      [challengeObjectId],
    )
    await expect(repository.findChallengeAsset(
      ownerId,
      false,
      challengeAssetId,
      new Date('2026-09-02T08:00:00.000Z'),
    )).resolves.toBeNull()
  })
})

async function createUser(database: DatabaseClient, prefix: string): Promise<string> {
  const suffix = randomUUID().replaceAll('-', '')
  const username = `${prefix}${suffix.slice(0, 8)}`
  const normalized = username.toLowerCase()
  const result = await database.pool.query<{ id: string }>(`
    INSERT INTO users (
      username, username_normalized, email, email_normalized,
      email_verified_at
    ) VALUES ($1, $2, $3, $3, now())
    RETURNING id`, [username, normalized, `${normalized}@example.test`])
  return result.rows[0]!.id
}
