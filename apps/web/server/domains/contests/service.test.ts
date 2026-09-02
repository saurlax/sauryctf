import { createHash, randomUUID } from 'node:crypto'
import { PostgresTestClient as Client } from '../../test-support/postgres-database'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SessionSubject } from '../identity/repository'
import { ParticipationService } from '../participations/service'
import { TeamService } from '../teams/service'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { runPostgresTestMigrations } from '../../test-support/postgres-database'
import { PostgresContestRepository } from '../../infrastructure/db/contest-repository'
import { PostgresParticipationRepository } from '../../infrastructure/db/participation-repository'
import { PostgresTeamRepository } from '../../infrastructure/db/team-repository'
import { createPublishableChallenge } from '../../test-support/publishable-challenge'
import { ContestService } from './service'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName() {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected database name')
  return `"${databaseName}"`
}

describeWithPostgres('contest lifecycle and shared UTC phase', () => {
  let admin: Client
  let database: PostgresTestDatabase
  let contests: ContestService
  let participations: ParticipationService
  let teams: TeamService
  let sequence = 0

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createPostgresTestDatabase({ connectionString: url.toString(), maxConnections: 16 })
    await runPostgresTestMigrations(database)
    contests = new ContestService(new PostgresContestRepository(database.executor))
    participations = new ParticipationService(new PostgresParticipationRepository(database.executor))
    teams = new TeamService(new PostgresTeamRepository(database.executor))
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
    const username = `ContestFlow${sequence}`
    const email = `contest-flow-${sequence}@example.test`
    const inserted = await database.executor.query<{ id: string }>(
      `INSERT INTO users
         (username, username_normalized, email, email_normalized, email_verified_at)
       VALUES ($1::varchar(64), lower($1::text)::varchar(64),
               $2::varchar(320), lower($2::text)::varchar(320), now())
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

  async function draft(
    organizer: SessionSubject,
    timing: 'upcoming' | 'running' | 'ended' = 'upcoming',
  ) {
    sequence++
    const now = Date.now()
    const windows = {
      upcoming: [now + 3_600_000, now + 7_200_000],
      running: [now - 3_600_000, now + 3_600_000],
      ended: [now - 7_200_000, now - 3_600_000],
    } as const
    const created = await contests.createDraft(organizer, {
      requestId: randomUUID(),
      title: `Contest Lifecycle ${sequence}`,
      slug: `contest-lifecycle-${sequence}`,
      description: 'Lifecycle test contest',
      startAt: new Date(windows[timing][0]),
      endAt: new Date(windows[timing][1]),
    })
    await createPublishableChallenge(database.executor, created.id, organizer.userId)
    return created
  }

  it('creates a hidden draft with audit evidence and only organizer capabilities', async () => {
    const organizer = await user('organizer')
    const ordinary = await user()
    const created = await draft(organizer)

    expect(created).toMatchObject({ publicationStatus: 'draft', phase: null, version: 1 })
    await expect(contests.readPublic(created.id)).rejects.toMatchObject({ code: 'contest.not_found' })
    await expect(contests.readManaged(ordinary, created.id)).rejects.toMatchObject({
      code: 'identity.capability_forbidden',
    })
    const audit = await database.executor.query<{ action: string, outcome: string }>(
      'SELECT action, outcome FROM audit_events WHERE target_id = $1',
      [created.id],
    )
    expect(audit.rows).toEqual([{ action: 'contest.created', outcome: 'succeeded' }])
  })

  it('publishes a draft once and exposes the authoritative UTC phase', async () => {
    const organizer = await user('organizer')
    const created = await draft(organizer, 'running')
    const published = await contests.publish(organizer, {
      requestId: randomUUID(),
      contestId: created.id,
      reason: 'Open the scheduled contest',
    })

    expect(published).toMatchObject({ publicationStatus: 'published', phase: 'running', version: 2 })
    expect(published.publishedAt).toBeInstanceOf(Date)
    await expect(contests.readPublic(created.id)).resolves.toMatchObject({ phase: 'running' })
    await expect(contests.publish(organizer, {
      requestId: randomUUID(), contestId: created.id, reason: 'Duplicate publication attempt',
    })).rejects.toMatchObject({ code: 'contest.transition_invalid' })
  })

  it('uses the same phase boundary for contest reads, registration and team locking', async () => {
    const organizer = await user('organizer')
    const upcomingCaptain = await user()
    const runningCaptain = await user()
    const endedCaptain = await user()
    const upcomingTeam = await teams.create(upcomingCaptain, 'Upcoming Team')
    await teams.create(runningCaptain, 'Running Team')
    await teams.create(endedCaptain, 'Ended Team')
    const created = await draft(organizer, 'upcoming')
    await contests.publish(organizer, {
      requestId: randomUUID(), contestId: created.id, reason: 'Publish phase boundary contest',
    })

    await expect(contests.readManaged(organizer, created.id)).resolves.toMatchObject({ phase: 'upcoming' })
    const pending = await participations.register(upcomingCaptain, created.id)
    await participations.review(organizer, {
      requestId: randomUUID(), contestId: created.id, participationId: pending.id,
      decision: 'accepted', reason: 'Accept upcoming team',
    })
    await expect(teams.current(upcomingCaptain)).resolves.toMatchObject({
      locks: [expect.objectContaining({ id: created.id })],
    })

    await database.executor.query(
      `UPDATE contests SET start_at = CURRENT_TIMESTAMP - interval '1 hour',
                           end_at = CURRENT_TIMESTAMP + interval '1 hour'
       WHERE id = $1`,
      [created.id],
    )
    await expect(contests.readManaged(organizer, created.id)).resolves.toMatchObject({ phase: 'running' })
    await expect(participations.register(runningCaptain, created.id)).resolves.toMatchObject({ status: 'pending' })
    await expect(teams.current(upcomingCaptain)).resolves.toMatchObject({ locks: [expect.anything()] })

    await database.executor.query(
      `UPDATE contests SET start_at = CURRENT_TIMESTAMP - interval '2 hours',
                           end_at = CURRENT_TIMESTAMP - interval '1 hour'
       WHERE id = $1`,
      [created.id],
    )
    await expect(contests.readManaged(organizer, created.id)).resolves.toMatchObject({ phase: 'ended' })
    await expect(participations.register(endedCaptain, created.id)).rejects.toMatchObject({
      code: 'participation.registration_closed',
    })
    await expect(teams.current(upcomingCaptain)).resolves.toMatchObject({ locks: [] })
    expect(upcomingTeam.team.id).toBeTruthy()
  })

  it('archives only an ended published contest and keeps final public phase read-only', async () => {
    const organizer = await user('organizer')
    const created = await draft(organizer, 'running')
    await contests.publish(organizer, {
      requestId: randomUUID(), contestId: created.id, reason: 'Publish archive candidate',
    })
    await expect(contests.archive(organizer, {
      requestId: randomUUID(), contestId: created.id, reason: 'Archive too early',
    })).rejects.toMatchObject({ code: 'contest.not_ended' })

    await database.executor.query(
      `UPDATE contests SET start_at = CURRENT_TIMESTAMP - interval '2 hours',
                           end_at = CURRENT_TIMESTAMP - interval '1 hour'
       WHERE id = $1`,
      [created.id],
    )
    const archived = await contests.archive(organizer, {
      requestId: randomUUID(), contestId: created.id, reason: 'Archive completed contest',
    })
    expect(archived).toMatchObject({ publicationStatus: 'archived', phase: 'ended', version: 3 })
    expect(archived.archivedAt).toBeInstanceOf(Date)
    await expect(contests.readPublic(created.id)).resolves.toMatchObject({ phase: 'ended' })
    await expect(contests.archive(organizer, {
      requestId: randomUUID(), contestId: created.id, reason: 'Duplicate archive attempt',
    })).rejects.toMatchObject({ code: 'contest.transition_invalid' })
  })

  it('rolls back publication when immutable audit insertion fails', async () => {
    const organizer = await user('organizer')
    const created = await draft(organizer)
    const requestId = randomUUID()
    await database.executor.query(
      `INSERT INTO audit_events
         (actor_user_id, action, target_type, target_id, reason, outcome, request_id, changes, metadata)
       VALUES ($1, 'contest.published', 'contest', $2, 'Existing event',
               'succeeded', $3, '{}', '{}')`,
      [organizer.userId, created.id, requestId],
    )

    await expect(contests.publish(organizer, {
      requestId, contestId: created.id, reason: 'Publication with duplicate audit',
    })).rejects.toMatchObject({ code: '23505' })
    await expect(contests.readManaged(organizer, created.id)).resolves.toMatchObject({
      publicationStatus: 'draft',
      publishedAt: null,
      version: 1,
    })
  })

  it('serializes concurrent lifecycle transitions', async () => {
    const organizer = await user('organizer')
    const created = await draft(organizer)
    const results = await Promise.allSettled([
      contests.publish(organizer, {
        requestId: randomUUID(), contestId: created.id, reason: 'Concurrent publish A',
      }),
      contests.publish(organizer, {
        requestId: randomUUID(), contestId: created.id, reason: 'Concurrent publish B',
      }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    await expect(contests.readManaged(organizer, created.id)).resolves.toMatchObject({
      publicationStatus: 'published', version: 2,
    })
  })

  it('persists a complete draft configuration without exposing the invite secret', async () => {
    const organizer = await user('organizer')
    const inviteCode = 'contest-invite-value-000000000001'
    sequence++
    const created = await contests.createDraft(organizer, {
      requestId: randomUUID(),
      title: `Configured Contest ${sequence}`,
      slug: `configured-contest-${sequence}`,
      description: 'Complete contest configuration',
      visibility: 'public',
      inviteRequired: true,
      inviteCode,
      registrationStrategy: 'auto_accept',
      startAt: new Date('2030-05-01T00:00:00.000Z'),
      endAt: new Date('2030-05-01T08:00:00.000Z'),
      scoreboardFreezeAt: new Date('2030-05-01T07:00:00.000Z'),
      practiceEnabled: true,
      writeupRequired: true,
      writeupDeadlineAt: new Date('2030-05-02T08:00:00.000Z'),
      minTeamSize: 2,
      maxTeamSize: 6,
      allowedEmailDomains: ['Example.EDU', 'example.edu', 'ctf.example'],
    })

    expect(created).toMatchObject({
      visibility: 'public',
      inviteRequired: true,
      inviteConfigured: true,
      registrationStrategy: 'auto_accept',
      scoreboardFreezeAt: new Date('2030-05-01T07:00:00.000Z'),
      practiceEnabled: true,
      writeupRequired: true,
      writeupDeadlineAt: new Date('2030-05-02T08:00:00.000Z'),
      minTeamSize: 2,
      maxTeamSize: 6,
      registrationConstraints: { allowedEmailDomains: ['example.edu', 'ctf.example'] },
    })
    expect(JSON.stringify(created)).not.toContain(inviteCode)

    const stored = await database.executor.query<{
      invite_digest: Buffer
      registration_constraints: { allowed_email_domains: string[] }
    }>('SELECT invite_digest, registration_constraints FROM contests WHERE id = $1', [created.id])
    expect(stored.rows[0]!.invite_digest).toEqual(createHash('sha256').update(inviteCode).digest())
    expect(stored.rows[0]!.registration_constraints).toEqual({
      allowed_email_domains: ['example.edu', 'ctf.example'],
    })
  })

  it('keeps discovery visibility and invite requirements independent', async () => {
    const organizer = await user('organizer')
    sequence++
    const privateWithoutInvite = await contests.createDraft(organizer, {
      requestId: randomUUID(), title: `Private Contest ${sequence}`,
      slug: `private-contest-${sequence}`, description: '', visibility: 'private',
      inviteRequired: false,
      startAt: new Date('2030-05-01T00:00:00.000Z'),
      endAt: new Date('2030-05-01T08:00:00.000Z'),
    })
    expect(privateWithoutInvite).toMatchObject({
      visibility: 'private', inviteRequired: false, inviteConfigured: false,
    })
    await createPublishableChallenge(database.executor, privateWithoutInvite.id, organizer.userId)
    await contests.publish(organizer, {
      requestId: randomUUID(),
      contestId: privateWithoutInvite.id,
      reason: 'Publish private discovery test',
    })
    await expect(contests.readPublic(privateWithoutInvite.id)).rejects.toMatchObject({
      code: 'contest.not_found',
    })
  })

  it('rejects invalid configurations with precise fields before writing facts or audit', async () => {
    const organizer = await user('organizer')
    const base = {
      requestId: randomUUID(),
      title: 'Invalid Configuration',
      slug: 'invalid-configuration',
      description: '',
      startAt: new Date('2030-05-01T00:00:00.000Z'),
      endAt: new Date('2030-05-01T08:00:00.000Z'),
    }
    const cases: Array<{
      field: string
      input: Parameters<ContestService['createDraft']>[1]
    }> = [
      { field: 'end_at', input: { ...base, endAt: new Date('2030-05-01T00:00:00.000Z') } },
      { field: 'scoreboard_freeze_at', input: { ...base, scoreboardFreezeAt: new Date('2030-04-30T23:59:59.000Z') } },
      { field: 'writeup_deadline_at', input: { ...base, writeupRequired: true, writeupDeadlineAt: new Date('2030-05-01T07:59:59.000Z') } },
      { field: 'writeup_deadline_at', input: { ...base, writeupRequired: false, writeupDeadlineAt: new Date('2030-05-02T00:00:00.000Z') } },
      { field: 'invite_code', input: { ...base, inviteRequired: true } },
      { field: 'min_team_size', input: { ...base, minTeamSize: 0 } },
      { field: 'max_team_size', input: { ...base, minTeamSize: 5, maxTeamSize: 4 } },
      { field: 'visibility', input: { ...base, visibility: 'hidden' as 'public' } },
      { field: 'registration_strategy', input: { ...base, registrationStrategy: 'instant' as 'review' } },
      { field: 'registration_constraints.allowed_email_domains.0', input: { ...base, allowedEmailDomains: ['invalid_domain!'] } },
    ]
    const before = await database.executor.query<{ count: string }>('SELECT count(*)::text AS count FROM contests')
    for (const testCase of cases) {
      await expect(contests.createDraft(organizer, testCase.input)).rejects.toMatchObject({
        code: 'contest.configuration_invalid',
        fields: { [testCase.field]: expect.any(Array) },
      })
    }
    const after = await database.executor.query<{ count: string }>('SELECT count(*)::text AS count FROM contests')
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count)
  })

  it('updates only a draft with optimistic concurrency and one transactional audit', async () => {
    const organizer = await user('organizer')
    const created = await draft(organizer)
    const inviteCode = 'updated-contest-invite-000000000001'
    const requestId = randomUUID()
    const updated = await contests.updateDraft(organizer, {
      requestId,
      contestId: created.id,
      expectedVersion: created.version,
      reason: 'Apply final registration policy',
      visibility: 'private',
      inviteRequired: true,
      inviteCode,
      registrationStrategy: 'auto_accept',
      practiceEnabled: true,
      writeupRequired: true,
      writeupDeadlineAt: new Date(created.endAt.getTime() + 86_400_000),
      minTeamSize: 2,
      maxTeamSize: 8,
      allowedEmailDomains: ['Example.EDU', 'example.edu'],
    })

    expect(updated).toMatchObject({
      version: 2,
      visibility: 'private',
      inviteRequired: true,
      inviteConfigured: true,
      registrationStrategy: 'auto_accept',
      practiceEnabled: true,
      writeupRequired: true,
      minTeamSize: 2,
      maxTeamSize: 8,
      registrationConstraints: { allowedEmailDomains: ['example.edu'] },
    })
    await expect(contests.updateDraft(organizer, {
      requestId: randomUUID(), contestId: created.id, expectedVersion: 1,
      reason: 'Attempt stale update', practiceEnabled: false,
    })).rejects.toMatchObject({ code: 'resource.version_conflict' })

    const audit = await database.executor.query<{ action: string, request_id: string }>(
      `SELECT action, request_id FROM audit_events
       WHERE target_id = $1 AND action = 'contest.configuration_updated'`,
      [created.id],
    )
    expect(audit.rows).toEqual([{ action: 'contest.configuration_updated', request_id: requestId }])
  })

  it('rejects ordinary users and locks published or archived configuration', async () => {
    const organizer = await user('organizer')
    const ordinary = await user()
    const created = await draft(organizer, 'ended')
    await expect(contests.updateDraft(ordinary, {
      requestId: randomUUID(), contestId: created.id, expectedVersion: 1,
      reason: 'Unauthorized configuration update', practiceEnabled: true,
    })).rejects.toMatchObject({ code: 'identity.capability_forbidden' })

    const published = await contests.publish(organizer, {
      requestId: randomUUID(), contestId: created.id, reason: 'Publish lock candidate',
    })
    await expect(contests.updateDraft(organizer, {
      requestId: randomUUID(), contestId: created.id, expectedVersion: published.version,
      reason: 'Published configuration update', practiceEnabled: true,
    })).rejects.toMatchObject({ code: 'contest.configuration_locked' })

    const archived = await contests.archive(organizer, {
      requestId: randomUUID(), contestId: created.id, reason: 'Archive lock candidate',
    })
    await expect(contests.updateDraft(organizer, {
      requestId: randomUUID(), contestId: created.id, expectedVersion: archived.version,
      reason: 'Archived configuration update', practiceEnabled: true,
    })).rejects.toMatchObject({ code: 'contest.configuration_locked' })
  })

  it('rolls back a draft update when its immutable audit insert fails', async () => {
    const organizer = await user('organizer')
    const created = await draft(organizer)
    const requestId = randomUUID()
    await database.executor.query(
      `INSERT INTO audit_events
         (actor_user_id, action, target_type, target_id, reason, outcome, request_id, changes, metadata)
       VALUES ($1, 'contest.configuration_updated', 'contest', $2, 'Existing event',
               'succeeded', $3, '{}', '{}')`,
      [organizer.userId, created.id, requestId],
    )

    await expect(contests.updateDraft(organizer, {
      requestId,
      contestId: created.id,
      expectedVersion: created.version,
      reason: 'Update with duplicate audit',
      practiceEnabled: true,
    })).rejects.toMatchObject({ code: '23505' })
    await expect(contests.readManaged(organizer, created.id)).resolves.toMatchObject({
      practiceEnabled: false,
      version: created.version,
    })
  })
})
