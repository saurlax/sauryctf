import { randomBytes, randomUUID } from 'node:crypto'
import { PostgresTestClient as Client } from '../../test-support/postgres-database'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { PostgresChallengeTemplateRepository } from '../../infrastructure/db/challenge-template-repository'
import { PostgresContestChallengeRepository } from '../../infrastructure/db/contest-challenge-repository'
import { runPostgresTestMigrations } from '../../test-support/postgres-database'
import type { SessionSubject } from '../identity/repository'
import { ContestChallengeService } from './contest-challenge-service'
import { ChallengeTemplateService } from './service'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName() {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected database name')
  return `"${databaseName}"`
}

describeWithPostgres('contest challenge snapshots and explicit revisions', () => {
  let admin: Client
  let database: PostgresTestDatabase
  let templates: ChallengeTemplateService
  let challenges: ContestChallengeService
  let sequence = 0

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createPostgresTestDatabase({ connectionString: url.toString(), maxConnections: 16 })
    await runPostgresTestMigrations(database)
    templates = new ChallengeTemplateService(new PostgresChallengeTemplateRepository(database.executor))
    challenges = new ContestChallengeService(new PostgresContestChallengeRepository(database.executor))
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

  async function user(role: SessionSubject['role'] = 'organizer'): Promise<SessionSubject> {
    sequence++
    const username = `SnapshotUser${sequence}`
    const email = `snapshot-user-${sequence}@example.test`
    const result = await database.executor.query<{ id: string }>(
      `INSERT INTO users
         (username, username_normalized, email, email_normalized, email_verified_at)
       VALUES ($1::varchar(64), lower($1::text)::varchar(64),
               $2::varchar(320), lower($2::text)::varchar(320), CURRENT_TIMESTAMP)
       RETURNING id`,
      [username, email],
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

  async function content(actorId: string, filename: string) {
    const result = await database.executor.query<{ id: string }>(
      `INSERT INTO content_objects
         (storage_key, sha256_digest, size_bytes, media_type, original_filename,
          status, created_by, committed_at)
       VALUES ($1, $2, 128, 'application/octet-stream', $3,
               'committed', $4, CURRENT_TIMESTAMP)
       RETURNING id`,
      [`objects/${randomUUID()}`, randomBytes(32), filename, actorId],
    )
    return result.rows[0]!.id
  }

  async function contest(actorId: string) {
    sequence++
    const result = await database.executor.query<{ id: string, start_at: Date }>(
      `INSERT INTO contests
         (title, slug, description, visibility, registration_strategy,
          start_at, end_at, created_by)
       VALUES ($1, $2, 'Snapshot contest', 'public', 'review',
               CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP + INTERVAL '2 days', $3)
       RETURNING id, start_at`,
      [`Snapshot Contest ${sequence}`, `snapshot-contest-${sequence}`, actorId],
    )
    return result.rows[0]!
  }

  async function template(organizer: SessionSubject, objectId: string) {
    sequence++
    return templates.create(organizer, {
      requestId: randomUUID(),
      name: `Snapshot Template ${sequence}`,
      slug: `snapshot-template-${sequence}`,
      title: `Snapshot Challenge ${sequence}`,
      category: 'web',
      description: 'Original statement copied into the contest',
      flagFormat: 'flag{...}',
      flagPolicy: { type: 'static', digest: 'a'.repeat(64) },
      scoringPolicy: { type: 'fixed-v1', points: 500 },
      instancePolicy: { type: 'none' },
      assets: [{ contentObjectId: objectId, displayName: 'starter.zip', sortOrder: 5 }],
      hints: [{
        title: 'Delayed hint',
        content: 'Inspect the response headers',
        releaseAfterSeconds: 900,
        sortOrder: 3,
      }],
    })
  }

  async function mountedFixture() {
    const organizer = await user()
    const objectId = await content(organizer.userId, 'starter.zip')
    const draft = await contest(organizer.userId)
    const source = await template(organizer, objectId)
    const mounted = await challenges.mount(organizer, {
      requestId: randomUUID(),
      contestId: draft.id,
      templateVersionId: source.challengeVersion.id,
      enabled: true,
      publishAt: null,
      closeAt: null,
      submissionLimit: 100,
      sortOrder: 10,
    })
    return { organizer, objectId, draft, source, mounted }
  }

  async function participate(
    player: SessionSubject,
    contestId: string,
    status: 'pending' | 'accepted',
  ) {
    const connection = await database.connect()
    try {
      await connection.query('BEGIN')
      sequence++
      const team = await connection.query<{ id: string }>(
        `INSERT INTO teams (name, name_normalized, created_by)
         VALUES ($1::varchar(80), lower($1::text)::varchar(80), $2) RETURNING id`,
        [`Projection Team ${sequence}`, player.userId],
      )
      await connection.query(
        `INSERT INTO team_members (team_id, user_id, role)
         VALUES ($1, $2, 'captain')`,
        [team.rows[0]!.id, player.userId],
      )
      await connection.query(
        `INSERT INTO participations
           (contest_id, team_id, status, registered_by, reviewed_by, reviewed_at)
         VALUES ($1, $2, $3::participation_status, $4, $5, $6)`,
        [
          contestId,
          team.rows[0]!.id,
          status,
          player.userId,
          status === 'accepted' ? player.userId : null,
          status === 'accepted' ? new Date() : null,
        ],
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
  }

  it('mounts the selected immutable version and copies attachment and hint snapshots', async () => {
    const fixture = await mountedFixture()
    expect(fixture.mounted).toMatchObject({
      sourceVersionId: fixture.source.challengeVersion.id,
      sourceVersionNumber: 1,
      snapshotRevision: 1,
      description: 'Original statement copied into the contest',
      assets: [expect.objectContaining({
        contentObjectId: fixture.objectId,
        displayName: 'starter.zip',
      })],
      hints: [expect.objectContaining({
        title: 'Delayed hint',
        content: 'Inspect the response headers',
      })],
    })
    expect(fixture.mounted.hints[0]!.releaseAt?.getTime()).toBe(
      fixture.draft.start_at.getTime() + 900_000,
    )

    await database.executor.query(
      `UPDATE contests SET publication_status = 'published', published_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [fixture.draft.id],
    )
    await templates.createVersion(fixture.organizer, {
      requestId: randomUUID(),
      templateId: fixture.source.template.id,
      expectedVersion: 1,
      reason: 'Prepare a future contest version',
      description: 'A new template statement',
      hints: [{ title: 'New hint', content: 'Only new mounts receive this', releaseAfterSeconds: null, sortOrder: 0 }],
    })
    await expect(challenges.read(
      fixture.organizer,
      fixture.draft.id,
      fixture.mounted.id,
    )).resolves.toMatchObject({
      sourceVersionNumber: 1,
      snapshotRevision: 1,
      description: 'Original statement copied into the contest',
      hints: [expect.objectContaining({ title: 'Delayed hint' })],
    })

    const audit = await database.executor.query<{ action: string }>(
      'SELECT action FROM audit_events WHERE target_id = $1 ORDER BY occurred_at',
      [fixture.mounted.id],
    )
    expect(audit.rows.map(row => row.action)).toEqual(['contest.challenge.mounted'])
  })

  it('blocks direct published mutations and applies one explicit revision with audit only', async () => {
    const fixture = await mountedFixture()
    const replacementId = await content(fixture.organizer.userId, 'replacement.zip')
    await database.executor.query(
      `UPDATE contests SET publication_status = 'published', published_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [fixture.draft.id],
    )

    await expect(database.executor.query(
      `UPDATE contest_challenges SET description = 'silent overwrite' WHERE id = $1`,
      [fixture.mounted.id],
    )).rejects.toMatchObject({ code: '55000' })
    await expect(database.executor.query(
      `UPDATE challenge_hints SET content = 'silent overwrite' WHERE contest_challenge_id = $1`,
      [fixture.mounted.id],
    )).rejects.toMatchObject({ code: '55000' })

    const revised = await challenges.revise(fixture.organizer, {
      requestId: randomUUID(),
      contestId: fixture.draft.id,
      challengeId: fixture.mounted.id,
      expectedVersion: 1,
      reason: 'Correct a fairness-impacting statement error',
      description: 'Corrected published statement',
      assets: [{ contentObjectId: replacementId, displayName: 'replacement.zip', sortOrder: 0 }],
      hints: [{
        title: 'Corrected hint',
        content: 'Use the corrected endpoint',
        releaseAt: new Date(),
        sortOrder: 0,
      }],
    })

    expect(revised).toMatchObject({
      snapshotRevision: 2,
      version: 2,
      description: 'Corrected published statement',
      assets: [expect.objectContaining({ contentObjectId: replacementId })],
      hints: [expect.objectContaining({ title: 'Corrected hint' })],
    })
    const evidence = await database.executor.query<{
      action: string
      reason: string
      changes: { snapshot_revision: number, resource_version: number, changed_fields: string[] }
    }>(
      `SELECT action, reason, changes
       FROM audit_events
       WHERE target_id = $1 AND action = 'contest.challenge.snapshot_revised'`,
      [fixture.mounted.id],
    )
    expect(evidence.rows).toEqual([expect.objectContaining({
      action: 'contest.challenge.snapshot_revised',
      reason: 'Correct a fairness-impacting statement error',
      changes: expect.objectContaining({
        snapshot_revision: 2,
        resource_version: 2,
        changed_fields: expect.arrayContaining(['description', 'assets', 'hints']),
      }),
    })])
    const broadcasts = await database.executor.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM domain_outbox
       WHERE aggregate_id = $1 AND event_type = 'contest.challenge.snapshot_revised'`,
      [fixture.mounted.id],
    )
    expect(broadcasts.rows[0]!.count).toBe('0')
  })

  it('serializes concurrent revisions and rolls unavailable attachments back atomically', async () => {
    const fixture = await mountedFixture()
    await database.executor.query(
      `UPDATE contests SET publication_status = 'published', published_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [fixture.draft.id],
    )
    const results = await Promise.allSettled([
      challenges.revise(fixture.organizer, {
        requestId: randomUUID(), contestId: fixture.draft.id, challengeId: fixture.mounted.id,
        expectedVersion: 1, reason: 'Concurrent correction A', description: 'Correction A',
      }),
      challenges.revise(fixture.organizer, {
        requestId: randomUUID(), contestId: fixture.draft.id, challengeId: fixture.mounted.id,
        expectedVersion: 1, reason: 'Concurrent correction B', description: 'Correction B',
      }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: { code: 'resource.version_conflict' },
    })

    await expect(challenges.revise(fixture.organizer, {
      requestId: randomUUID(),
      contestId: fixture.draft.id,
      challengeId: fixture.mounted.id,
      expectedVersion: 2,
      reason: 'Attempt unavailable attachment replacement',
      assets: [{ contentObjectId: randomUUID(), displayName: 'missing.zip', sortOrder: 0 }],
    })).rejects.toMatchObject({ code: 'challenge.asset_unavailable' })
    const current = await challenges.read(fixture.organizer, fixture.draft.id, fixture.mounted.id)
    expect(current).toMatchObject({ snapshotRevision: 2, version: 2 })
    await expect(challenges.revise(fixture.organizer, {
      requestId: randomUUID(),
      contestId: fixture.draft.id,
      challengeId: fixture.mounted.id,
      expectedVersion: 2,
      reason: 'Attempt a no-op emergency revision',
      title: current.title,
    })).rejects.toMatchObject({ code: 'challenge.revision_unchanged' })
    const counts = await database.executor.query<{ audits: string, events: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit_events
          WHERE target_id = $1 AND action = 'contest.challenge.snapshot_revised') AS audits,
         (SELECT count(*)::text FROM domain_outbox
          WHERE aggregate_id = $1 AND event_type = 'contest.challenge.snapshot_revised') AS events`,
      [fixture.mounted.id],
    )
    expect(counts.rows[0]).toEqual({ audits: '1', events: '0' })
  })

  it('rolls a mount back when a version attachment is no longer committed', async () => {
    const organizer = await user()
    const objectId = await content(organizer.userId, 'quarantined.zip')
    const draft = await contest(organizer.userId)
    const source = await template(organizer, objectId)
    await database.executor.query(
      `UPDATE content_objects SET status = 'quarantined' WHERE id = $1`,
      [objectId],
    )

    await expect(challenges.mount(organizer, {
      requestId: randomUUID(),
      contestId: draft.id,
      templateVersionId: source.challengeVersion.id,
      enabled: true,
      publishAt: null,
      closeAt: null,
      submissionLimit: null,
      sortOrder: 0,
    })).rejects.toMatchObject({ code: 'challenge.asset_unavailable' })
    const facts = await database.executor.query<{ challenges: string, audits: string }>(
      `SELECT
         (SELECT count(*)::text FROM contest_challenges WHERE contest_id = $1) AS challenges,
         (SELECT count(*)::text FROM audit_events
          WHERE action = 'contest.challenge.mounted' AND changes ->> 'contest_id' = $1::text) AS audits`,
      [draft.id],
    )
    expect(facts.rows[0]).toEqual({ challenges: '0', audits: '0' })
  })

  it('enforces manager authorization and draft, published, and archived command boundaries', async () => {
    const fixture = await mountedFixture()
    const ordinary = await user('user')
    await expect(challenges.read(ordinary, fixture.draft.id, fixture.mounted.id)).rejects.toMatchObject({
      code: 'identity.capability_forbidden',
    })
    await expect(challenges.revise(fixture.organizer, {
      requestId: randomUUID(), contestId: fixture.draft.id, challengeId: fixture.mounted.id,
      expectedVersion: 1, reason: 'Not an emergency yet', description: 'Draft revision',
    })).rejects.toMatchObject({ code: 'challenge.revision_not_allowed' })

    await database.executor.query(
      `UPDATE contests
       SET publication_status = 'archived', published_at = CURRENT_TIMESTAMP,
           archived_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [fixture.draft.id],
    )
    await expect(challenges.mount(fixture.organizer, {
      requestId: randomUUID(), contestId: fixture.draft.id,
      templateVersionId: fixture.source.challengeVersion.id,
      enabled: false, publishAt: null, closeAt: null, submissionLimit: null, sortOrder: 20,
    })).rejects.toMatchObject({ code: 'challenge.configuration_locked' })
    await expect(challenges.revise(fixture.organizer, {
      requestId: randomUUID(), contestId: fixture.draft.id, challengeId: fixture.mounted.id,
      expectedVersion: 1, reason: 'Archived correction attempt', description: 'Archived revision',
    })).rejects.toMatchObject({ code: 'challenge.contest_archived' })
  })

  it('uses authoritative participation and contest visibility facts for player projections', async () => {
    const fixture = await mountedFixture()
    const player = await user('user')
    const projectionTime = new Date('2030-05-01T06:00:00.000Z')
    await participate(player, fixture.draft.id, 'accepted')
    await database.executor.query(
      `UPDATE contest_challenges SET publish_at = $2 WHERE id = $1`,
      [fixture.mounted.id, new Date('2030-05-01T05:00:00.000Z')],
    )
    await database.executor.query(
      `UPDATE contests
       SET publication_status = 'published', published_at = CURRENT_TIMESTAMP,
           start_at = $2, end_at = $3
       WHERE id = $1`,
      [
        fixture.draft.id,
        new Date('2030-05-01T05:30:00.000Z'),
        new Date('2030-05-01T07:00:00.000Z'),
      ],
    )
    const playerChallenges = new ContestChallengeService(
      new PostgresContestChallengeRepository(database.executor),
      () => projectionTime,
    )

    await expect(playerChallenges.readForPlayer(
      player,
      fixture.draft.id,
      fixture.mounted.id,
    )).resolves.toMatchObject({
      state: 'open',
      content: {
        description: 'Original statement copied into the contest',
        assets: [{ displayName: 'starter.zip' }],
        hints: [{ title: 'Delayed hint' }],
      },
    })

    await database.executor.query(
      `UPDATE participations SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL
       WHERE contest_id = $1`,
      [fixture.draft.id],
    )
    await expect(playerChallenges.readForPlayer(
      player,
      fixture.draft.id,
      fixture.mounted.id,
    )).resolves.toMatchObject({ state: 'locked', content: null })

    await database.executor.query(
      `UPDATE contests SET visibility = 'private' WHERE id = $1`,
      [fixture.draft.id],
    )
    await expect(playerChallenges.readForPlayer(
      player,
      fixture.draft.id,
      fixture.mounted.id,
    )).rejects.toMatchObject({ code: 'challenge.not_found' })
  })
})
