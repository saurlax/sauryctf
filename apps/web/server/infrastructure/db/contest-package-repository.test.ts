import { randomBytes, randomUUID } from 'node:crypto'
import { PostgresTestClient as Client } from '../../test-support/postgres-database'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { contestPackageFormat, contestPackageManifestSchema } from '../../../shared/contracts/contest-packages'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { runPostgresTestMigrations } from '../../test-support/postgres-database'
import { PostgresContestPackageRepository } from './contest-package-repository'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName() {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected database name')
  return `"${databaseName}"`
}

describeWithPostgres('atomic Jeopardy contest package import', () => {
  let admin: Client
  let database: PostgresTestDatabase
  let repository: PostgresContestPackageRepository
  let organizerId: string
  let packageObjectId: string

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createPostgresTestDatabase({ connectionString: url.toString(), maxConnections: 6 })
    await runPostgresTestMigrations(database)
    repository = new PostgresContestPackageRepository(database.executor)
    const organizer = await database.executor.query<{ id: string }>(`
      INSERT INTO users
        (username, username_normalized, email, email_normalized, email_verified_at)
      VALUES ('PackageOrganizer', 'packageorganizer',
              'package@example.test', 'package@example.test', now())
      RETURNING id`)
    organizerId = organizer.rows[0]!.id
    const object = await database.executor.query<{ id: string }>(`
      INSERT INTO content_objects
        (storage_key, sha256_digest, size_bytes, media_type, original_filename,
         status, created_by, committed_at)
      VALUES ($1, $2, 128, 'application/zip', 'contest.zip',
              'committed', $3, now())
      RETURNING id`, [`packages/${randomUUID()}`, randomBytes(32), organizerId])
    packageObjectId = object.rows[0]!.id
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

  it('creates a new draft with immutable source versions and is idempotent', async () => {
    const manifest = validManifest()
    const idempotencyKey = `package-import-${randomUUID()}`
    const first = await repository.importDraft({
      actorId: organizerId,
      requestId: randomUUID(),
      reason: 'restore portable contest content',
      idempotencyKey,
      packageObjectId,
      inviteDigest: null,
      manifest,
      files: [],
    })
    const second = await repository.importDraft({
      actorId: organizerId,
      requestId: randomUUID(),
      reason: 'retry same import',
      idempotencyKey,
      packageObjectId,
      inviteDigest: null,
      manifest,
      files: [],
    })

    expect(second).toEqual(first)
    const state = await database.executor.query<{
      publication_status: string
      challenge_count: string
      version_count: string
    }>(`
      SELECT contest.publication_status::text,
        (SELECT count(*)::text FROM contest_challenges challenge WHERE challenge.contest_id = contest.id) AS challenge_count,
        (SELECT count(*)::text FROM challenge_template_versions version
          JOIN challenge_templates template ON template.id = version.template_id
          WHERE template.slug LIKE 'imported-%') AS version_count
      FROM contests contest WHERE contest.id = $1`, [first.contestId])
    expect(state.rows[0]).toMatchObject({
      publication_status: 'draft',
      challenge_count: '1',
      version_count: '1',
    })
  })

  it('rolls back the whole import when a later challenge violates a database constraint', async () => {
    const before = await counts()
    const manifest = validManifest() as ReturnType<typeof validManifest>
    manifest.contest.challenges.push({ ...manifest.contest.challenges[0]! })

    await expect(repository.importDraft({
      actorId: organizerId,
      requestId: randomUUID(),
      reason: 'exercise transaction rollback',
      idempotencyKey: `package-import-${randomUUID()}`,
      packageObjectId,
      inviteDigest: null,
      manifest,
      files: [],
    })).rejects.toThrow()

    expect(await counts()).toEqual(before)
  })

  async function counts() {
    const result = await database.executor.query<{ contests: string, templates: string, imports: string }>(`
      SELECT
        (SELECT count(*)::text FROM contests) AS contests,
        (SELECT count(*)::text FROM challenge_templates) AS templates,
        (SELECT count(*)::text FROM imports) AS imports`)
    return result.rows[0]
  }
})

function validManifest() {
  return contestPackageManifestSchema.parse({
    format: contestPackageFormat,
    compatibility: { minimum: '1.0.0', maximum: '1.x' },
    exported_at: '2026-09-02T00:00:00.000Z',
    contest: {
      title: 'Imported Autumn CTF',
      slug: 'imported-autumn-ctf',
      description: 'Portable Jeopardy contest',
      visibility: 'private',
      registration_strategy: 'review',
      invite_required: false,
      start_at: '2026-10-01T00:00:00.000Z',
      end_at: '2026-10-02T00:00:00.000Z',
      scoreboard_freeze_at: null,
      practice_enabled: true,
      writeup_required: false,
      writeup_deadline_at: null,
      min_team_size: 1,
      max_team_size: 5,
      registration_constraints: { allowed_email_domains: [] },
      divisions: [{ name: 'Open', sort_order: 0 }],
      challenges: [{
        title: 'Warmup',
        category: 'misc',
        description: 'Imported challenge',
        flag_format: 'flag{...}',
        flag_policy: { type: 'static', digest: 'a'.repeat(64) },
        scoring_policy: { type: 'fixed-v1', points: 100 },
        instance_policy: { type: 'none' },
        assets: [],
        hints: [{ title: 'Hint', content: 'Think portable.', release_at: null, sort_order: 0 }],
        enabled: true,
        publish_at: null,
        close_at: null,
        submission_limit: null,
        sort_order: 0,
      }],
    },
    files: [],
  })
}
