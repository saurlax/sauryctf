import { randomBytes, randomUUID } from 'node:crypto'
import { PostgresTestClient as Client } from '../../test-support/postgres-database'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { runPostgresTestMigrations } from '../../test-support/postgres-database'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName(): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected test database name')
  return `"${databaseName}"`
}

describeWithPostgres('challenge library and snapshot schema', () => {
  let admin: Client
  let database: PostgresTestDatabase
  let organizerId: string
  let contestId: string
  let templateId: string

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createPostgresTestDatabase({ connectionString: url.toString(), maxConnections: 4 })
    await runPostgresTestMigrations(database)

    const organizer = await database.executor.query<{ id: string }>(
      `INSERT INTO users (username, username_normalized, email, email_normalized)
       VALUES ('ChallengeOrganizer', 'challengeorganizer', 'challenge-organizer@example.test', 'challenge-organizer@example.test') RETURNING id`,
    )
    organizerId = organizer.rows[0]!.id
    const contest = await database.executor.query<{ id: string }>(
      `INSERT INTO contests (title, slug, start_at, end_at, created_by)
       VALUES ('Snapshot Contest', $1, now() + interval '1 day', now() + interval '2 days', $2) RETURNING id`,
      [`snapshot-${randomUUID()}`, organizerId],
    )
    contestId = contest.rows[0]!.id
    const template = await database.executor.query<{ id: string }>(
      `INSERT INTO challenge_templates (name, slug, created_by)
       VALUES ('Web Template', $1, $2) RETURNING id`,
      [`web-${randomUUID()}`, organizerId],
    )
    templateId = template.rows[0]!.id
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

  async function createVersion(version: number, title: string): Promise<string> {
    const result = await database.executor.query<{ id: string }>(
      `INSERT INTO challenge_template_versions
         (template_id, version_number, title, category, description, flag_format, flag_policy, scoring_policy, instance_policy, created_by)
       VALUES ($1, $2, $3, 'web', 'Immutable statement', 'flag{...}', $4, $5, $6, $7)
       RETURNING id`,
      [templateId, version, title, { type: 'static', digest: 'masked' }, { type: 'fixed-v1', points: 500 }, { type: 'none' }, organizerId],
    )
    return result.rows[0]!.id
  }

  it('rejects unsupported categories at template and contest snapshot boundaries', async () => {
    await expect(database.executor.query(
      `INSERT INTO challenge_template_versions
         (template_id, version_number, title, category, description, flag_policy, scoring_policy, created_by)
       VALUES ($1, 99, 'Unsupported', 'awd', 'Rejected category', '{}', '{}', $2)`,
      [templateId, organizerId],
    )).rejects.toMatchObject({ code: '22P02' })

    const versionId = await createVersion(1, 'Allowed Web')
    await expect(database.executor.query(
      `INSERT INTO contest_challenges
         (contest_id, source_template_id, source_version_id, title, category, description, flag_policy, scoring_policy)
       VALUES ($1, $2, $3, 'Unsupported Snapshot', 'awd', 'Rejected category', '{}', '{}')`,
      [contestId, templateId, versionId],
    )).rejects.toMatchObject({ code: '22P02' })
  })

  it('rejects unknown or missing policy strategy types at both persistence boundaries', async () => {
    await expect(database.executor.query(
      `INSERT INTO challenge_template_versions
         (template_id, version_number, title, category, description,
          flag_policy, scoring_policy, instance_policy, created_by)
       VALUES ($1, 50, 'Unknown Policy', 'web', 'Rejected strategy',
               $2, $3, $4, $5)`,
      [
        templateId,
        { type: 'remote-checker' },
        { type: 'fixed-v1', points: 500 },
        { type: 'none' },
        organizerId,
      ],
    )).rejects.toMatchObject({
      code: '23514',
      constraint: 'challenge_template_versions_flag_policy_type',
    })
    await expect(database.executor.query(
      `INSERT INTO challenge_template_versions
         (template_id, version_number, title, category, description,
          flag_policy, scoring_policy, instance_policy, created_by)
       VALUES ($1, 51, 'Missing Policy Type', 'web', 'Rejected strategy',
               '{}', $2, $3, $4)`,
      [
        templateId,
        { type: 'fixed-v1', points: 500 },
        { type: 'none' },
        organizerId,
      ],
    )).rejects.toMatchObject({
      code: '23514',
      constraint: 'challenge_template_versions_flag_policy_type',
    })

    const versionId = await createVersion(52, 'Valid Policy Source')
    await expect(database.executor.query(
      `INSERT INTO contest_challenges
         (contest_id, source_template_id, source_version_id, title, category,
          description, flag_policy, scoring_policy, instance_policy)
       VALUES ($1, $2, $3, 'Unknown Snapshot Policy', 'web', 'Rejected strategy',
               $4, $5, $6)`,
      [
        contestId,
        templateId,
        versionId,
        { type: 'static', digest: 'masked' },
        { type: 'percentage-v1' },
        { type: 'none' },
      ],
    )).rejects.toMatchObject({
      code: '23514',
      constraint: 'contest_challenges_scoring_policy_type',
    })
  })

  it('keeps template versions immutable and snapshots independent from later versions', async () => {
    const versionId = await createVersion(2, 'Original Title')
    const snapshot = await database.executor.query<{ id: string }>(
      `INSERT INTO contest_challenges
         (contest_id, source_template_id, source_version_id, title, category, description, flag_policy, scoring_policy)
       SELECT $1, template_id, id, title, category, description, flag_policy, scoring_policy
       FROM challenge_template_versions WHERE id = $2 RETURNING id`,
      [contestId, versionId],
    )

    await expect(database.executor.query(
      `UPDATE challenge_template_versions SET title = 'Mutated' WHERE id = $1`,
      [versionId],
    )).rejects.toMatchObject({ code: '55000' })
    await createVersion(3, 'New Version Title')

    const persisted = await database.executor.query<{ title: string, snapshot_revision: number }>(
      'SELECT title, snapshot_revision FROM contest_challenges WHERE id = $1',
      [snapshot.rows[0]!.id],
    )
    expect(persisted.rows).toEqual([{ title: 'Original Title', snapshot_revision: 1 }])
  })

  it('maintains referential integrity for hints and immutable attachment objects', async () => {
    const versionId = await createVersion(4, 'Assets Challenge')
    const challenge = await database.executor.query<{ id: string }>(
      `INSERT INTO contest_challenges
         (contest_id, source_template_id, source_version_id, title, category, description, flag_policy, scoring_policy)
       SELECT $1, template_id, id, title, category, description, flag_policy, scoring_policy
       FROM challenge_template_versions WHERE id = $2 RETURNING id`,
      [contestId, versionId],
    )
    const object = await database.executor.query<{ id: string }>(
      `INSERT INTO content_objects
         (storage_key, sha256_digest, size_bytes, media_type, original_filename, status, created_by, committed_at)
       VALUES ($1, $2, 12, 'application/octet-stream', 'attachment.bin', 'committed', $3, now()) RETURNING id`,
      [`objects/${randomUUID()}`, randomBytes(32), organizerId],
    )
    await database.executor.query(
      `INSERT INTO challenge_hints (contest_challenge_id, title, content)
       VALUES ($1, 'Hint 1', 'Look closer')`,
      [challenge.rows[0]!.id],
    )
    await database.executor.query(
      `INSERT INTO challenge_assets (contest_challenge_id, content_object_id, display_name)
       VALUES ($1, $2, 'attachment.bin')`,
      [challenge.rows[0]!.id, object.rows[0]!.id],
    )
    await expect(database.executor.query(
      `INSERT INTO challenge_assets (contest_challenge_id, content_object_id, display_name)
       VALUES ($1, $2, 'duplicate.bin')`,
      [challenge.rows[0]!.id, object.rows[0]!.id],
    )).rejects.toMatchObject({ code: '23505' })
  })
})
