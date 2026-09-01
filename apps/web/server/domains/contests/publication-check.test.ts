import { randomBytes, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabaseClient, type DatabaseClient } from '../../infrastructure/db/client'
import { runMigrations } from '../../infrastructure/db/migrate'
import { PostgresContestRepository } from '../../infrastructure/db/contest-repository'
import { createPublishableChallenge } from '../../test-support/publishable-challenge'
import type { SessionSubject } from '../identity/repository'
import { ContestService } from './service'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName() {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected database name')
  return `"${databaseName}"`
}

describeWithPostgres('contest publication preflight', () => {
  let admin: Client
  let database: DatabaseClient
  let contests: ContestService
  let sequence = 0

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 12 })
    await runMigrations(database)
    contests = new ContestService(new PostgresContestRepository(database.pool))
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

  async function user(role: SessionSubject['role'] = 'organizer'): Promise<SessionSubject> {
    sequence++
    const username = `PublicationUser${sequence}`
    const email = `publication-${sequence}@example.test`
    const inserted = await database.pool.query<{ id: string }>(
      `INSERT INTO users
         (username, username_normalized, email, email_normalized, email_verified_at)
       VALUES ($1::varchar(64), lower($1::text)::varchar(64),
               $2::varchar(320), lower($2::text)::varchar(320), CURRENT_TIMESTAMP)
       RETURNING id`,
      [username, email],
    )
    return {
      userId: inserted.rows[0]!.id,
      username,
      email,
      emailVerified: true,
      status: 'active',
      role,
      sessionVersion: 1,
      mustChangePassword: false,
    }
  }

  async function draft(organizer: SessionSubject) {
    sequence++
    return contests.createDraft(organizer, {
      requestId: randomUUID(),
      title: `Publication Contest ${sequence}`,
      slug: `publication-contest-${sequence}`,
      description: 'Contest publication preflight test',
      startAt: new Date(Date.now() + 3_600_000),
      endAt: new Date(Date.now() + 7_200_000),
    })
  }

  it('reports an empty contest and permits only global contest managers to inspect it', async () => {
    const organizer = await user()
    const administrator = await user('admin')
    const ordinary = await user('user')
    const target = await draft(organizer)

    await expect(contests.checkPublication(organizer, target.id)).resolves.toEqual({
      ready: false,
      issues: [{
        code: 'contest.challenge_required',
        message: '发布比赛前至少需要启用一道比赛题目',
        resourceType: 'contest',
        resourceId: target.id,
        resourceTitle: null,
        field: 'challenges',
      }],
    })
    await expect(contests.checkPublication(administrator, target.id)).resolves.toMatchObject({ ready: false })
    await expect(contests.checkPublication(ordinary, target.id)).rejects.toMatchObject({
      code: 'identity.capability_forbidden',
    })
  })

  it('rejects publication atomically when preflight fails', async () => {
    const organizer = await user()
    const target = await draft(organizer)
    await expect(contests.publish(organizer, {
      requestId: randomUUID(),
      contestId: target.id,
      reason: 'Attempt incomplete publication',
    })).rejects.toMatchObject({
      code: 'contest.publication_check_failed',
      fields: { challenges: ['发布比赛前至少需要启用一道比赛题目'] },
    })

    await expect(contests.readManaged(organizer, target.id)).resolves.toMatchObject({
      publicationStatus: 'draft',
      publishedAt: null,
      version: 1,
    })
    const publishedAudits = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_events
       WHERE target_id = $1 AND action = 'contest.published'`,
      [target.id],
    )
    expect(publishedAudits.rows[0]!.count).toBe('0')
  })

  it('publishes a complete static challenge and ignores disabled invalid challenges', async () => {
    const organizer = await user()
    const target = await draft(organizer)
    await createPublishableChallenge(database.pool, target.id, organizer.userId)
    await createPublishableChallenge(database.pool, target.id, organizer.userId, {
      enabled: false,
      flagPolicy: { type: 'static', digest: '' },
      instancePolicy: { type: 'dynamic', provider: 'docker', entry_port: 80 },
    })

    await expect(contests.checkPublication(organizer, target.id)).resolves.toEqual({ ready: true, issues: [] })
    await expect(contests.publish(organizer, {
      requestId: randomUUID(), contestId: target.id, reason: 'Publish complete contest',
    })).resolves.toMatchObject({ publicationStatus: 'published', version: 2 })
  })

  it('locates incomplete challenge content and Flag policy fields', async () => {
    const organizer = await user()
    const target = await draft(organizer)
    const challenge = await createPublishableChallenge(database.pool, target.id, organizer.userId, {
      flagPolicy: { type: 'static' },
    })
    await database.pool.query(
      `UPDATE contest_challenges SET title = '', description = '' WHERE id = $1`,
      [challenge.challengeId],
    )

    const check = await contests.checkPublication(organizer, target.id)
    expect(check.ready).toBe(false)
    expect(check.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'challenge.title_missing',
        resourceId: challenge.challengeId,
        field: `challenges.${challenge.challengeId}.title`,
      }),
      expect.objectContaining({
        code: 'challenge.description_missing',
        resourceId: challenge.challengeId,
        field: `challenges.${challenge.challengeId}.description`,
      }),
      expect.objectContaining({
        code: 'challenge.flag_policy_invalid',
        resourceId: challenge.challengeId,
        field: `challenges.${challenge.challengeId}.flag_policy.digest`,
      }),
    ]))
  })

  it('locates unavailable attachments by challenge and asset identifier', async () => {
    const organizer = await user()
    const target = await draft(organizer)
    const challenge = await createPublishableChallenge(database.pool, target.id, organizer.userId)
    const object = await database.pool.query<{ id: string }>(
      `INSERT INTO content_objects
         (storage_key, sha256_digest, size_bytes, media_type, original_filename,
          status, created_by, committed_at)
       VALUES ($1, $2, 16, 'application/octet-stream', 'pending.bin',
               'committed', $3, CURRENT_TIMESTAMP)
       RETURNING id`,
      [`objects/${randomUUID()}`, randomBytes(32), organizer.userId],
    )
    const asset = await database.pool.query<{ id: string }>(
      `INSERT INTO challenge_assets (contest_challenge_id, content_object_id, display_name)
       VALUES ($1, $2, 'pending.bin') RETURNING id`,
      [challenge.challengeId, object.rows[0]!.id],
    )
    await database.pool.query(
      `UPDATE content_objects SET status = 'quarantined' WHERE id = $1`,
      [object.rows[0]!.id],
    )

    await expect(contests.checkPublication(organizer, target.id)).resolves.toMatchObject({
      ready: false,
      issues: [expect.objectContaining({
        code: 'challenge.asset_unavailable',
        resourceType: 'asset',
        resourceId: asset.rows[0]!.id,
        resourceTitle: 'pending.bin',
        field: `challenges.${challenge.challengeId}.assets.${asset.rows[0]!.id}`,
      })],
    })
  })

  it.each([
    [{ type: 'dynamic', provider: 'unsupported', image: 'challenge:latest', entry_port: 80 }, 'provider'],
    [{ type: 'dynamic', provider: 'docker', entry_port: 80 }, 'image'],
    [{ type: 'dynamic', provider: 'kubernetes', image: 'challenge:latest', entry_port: 0 }, 'entry_port'],
    [{ type: 'dynamic', provider: 'kubernetes', image: 'challenge:latest', entry_port: 65_536 }, 'entry_port'],
  ] as const)('locates invalid dynamic instance policy field %s', async (instancePolicy, field) => {
    const organizer = await user()
    const target = await draft(organizer)
    const challenge = await createPublishableChallenge(database.pool, target.id, organizer.userId, { instancePolicy })

    await expect(contests.checkPublication(organizer, target.id)).resolves.toMatchObject({
      ready: false,
      issues: [expect.objectContaining({
        code: 'challenge.instance_policy_invalid',
        resourceType: 'challenge',
        resourceId: challenge.challengeId,
        field: `challenges.${challenge.challengeId}.instance_policy.${field}`,
      })],
    })
  })

  it.each([
    [{ type: 'fixed-v1', points: 0 }, 'points'],
    [{ type: 'decay-v1', minimum_points: 100, decay_solves: 50 }, 'initial_points'],
    [{ type: 'decay-v1', initial_points: 100, minimum_points: 200, decay_solves: 50 }, 'minimum_points'],
  ] as const)('locates invalid scoring policy field %s', async (scoringPolicy, field) => {
    const organizer = await user()
    const target = await draft(organizer)
    const challenge = await createPublishableChallenge(database.pool, target.id, organizer.userId, { scoringPolicy })

    await expect(contests.checkPublication(organizer, target.id)).resolves.toMatchObject({
      ready: false,
      issues: [expect.objectContaining({
        code: 'challenge.scoring_policy_invalid',
        resourceType: 'challenge',
        resourceId: challenge.challengeId,
        field: `challenges.${challenge.challengeId}.scoring_policy.${field}`,
      })],
    })
  })
})
