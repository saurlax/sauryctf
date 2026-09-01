import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SessionSubject } from '../identity/repository'
import { ParticipationService } from '../participations/service'
import { TeamService } from '../teams/service'
import { createDatabaseClient, type DatabaseClient } from '../../infrastructure/db/client'
import { runMigrations } from '../../infrastructure/db/migrate'
import { PostgresContestRepository } from '../../infrastructure/db/contest-repository'
import { PostgresParticipationRepository } from '../../infrastructure/db/participation-repository'
import { PostgresTeamRepository } from '../../infrastructure/db/team-repository'
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
  let database: DatabaseClient
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
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 16 })
    await runMigrations(database)
    contests = new ContestService(new PostgresContestRepository(database.pool))
    participations = new ParticipationService(new PostgresParticipationRepository(database.pool))
    teams = new TeamService(new PostgresTeamRepository(database.pool))
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

  async function user(role: SessionSubject['role'] = 'user'): Promise<SessionSubject> {
    sequence++
    const username = `ContestFlow${sequence}`
    const email = `contest-flow-${sequence}@example.test`
    const inserted = await database.pool.query<{ id: string }>(
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
    return contests.createDraft(organizer, {
      requestId: randomUUID(),
      title: `Contest Lifecycle ${sequence}`,
      slug: `contest-lifecycle-${sequence}`,
      description: 'Lifecycle test contest',
      startAt: new Date(windows[timing][0]),
      endAt: new Date(windows[timing][1]),
    })
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
    const audit = await database.pool.query<{ action: string, outcome: string }>(
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

    await database.pool.query(
      `UPDATE contests SET start_at = CURRENT_TIMESTAMP - interval '1 hour',
                           end_at = CURRENT_TIMESTAMP + interval '1 hour'
       WHERE id = $1`,
      [created.id],
    )
    await expect(contests.readManaged(organizer, created.id)).resolves.toMatchObject({ phase: 'running' })
    await expect(participations.register(runningCaptain, created.id)).resolves.toMatchObject({ status: 'pending' })
    await expect(teams.current(upcomingCaptain)).resolves.toMatchObject({ locks: [expect.anything()] })

    await database.pool.query(
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

    await database.pool.query(
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
    await database.pool.query(
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
})
