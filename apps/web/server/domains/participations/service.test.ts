import { createHash, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SessionSubject } from '../identity/repository'
import { TeamService } from '../teams/service'
import { createDatabaseClient, type DatabaseClient } from '../../infrastructure/db/client'
import { runMigrations } from '../../infrastructure/db/migrate'
import { PostgresParticipationRepository } from '../../infrastructure/db/participation-repository'
import { PostgresTeamRepository } from '../../infrastructure/db/team-repository'
import { ParticipationService } from './service'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName() {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected database name')
  return `"${databaseName}"`
}

describeWithPostgres('participation registration transactions', () => {
  let admin: Client
  let database: DatabaseClient
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

  async function user(options: {
    role?: SessionSubject['role']
    emailDomain?: string
    emailVerified?: boolean
    status?: SessionSubject['status']
    mustChangePassword?: boolean
  } = {}): Promise<SessionSubject> {
    sequence++
    const username = `Participation${sequence}`
    const email = `participation-${sequence}@${options.emailDomain ?? 'example.test'}`
    const verifiedAt = options.emailVerified === false ? null : new Date()
    const status = options.status ?? 'active'
    const mustChangePassword = options.mustChangePassword ?? false
    const result = await database.pool.query<{ id: string }>(
      `INSERT INTO users
         (username, username_normalized, email, email_normalized, email_verified_at, status, must_change_password)
       VALUES ($1::varchar(64), lower($1::varchar(64)), $2::varchar(320), lower($2::varchar(320)), $3, $4, $5)
       RETURNING id`,
      [username, email, verifiedAt, status, mustChangePassword],
    )
    return {
      userId: result.rows[0]!.id,
      username,
      email,
      emailVerified: verifiedAt !== null,
      status,
      role: options.role ?? 'user',
      sessionVersion: 1,
      mustChangePassword,
    }
  }

  async function contest(creator: SessionSubject, options: {
    strategy?: 'review' | 'auto_accept'
    visibility?: 'public' | 'private'
    publicationStatus?: 'draft' | 'published'
    ended?: boolean
    minTeamSize?: number
    maxTeamSize?: number
    allowedEmailDomains?: string[]
    inviteCode?: string
    divisionNames?: string[]
  } = {}) {
    sequence++
    const publicationStatus = options.publicationStatus ?? 'published'
    const startAt = new Date(Date.now() - 60_000)
    const endAt = new Date(Date.now() + (options.ended ? -60_000 : 3_600_000))
    if (options.ended) startAt.setTime(Date.now() - 3_600_000)
    const inviteDigest = options.inviteCode
      ? createHash('sha256').update(options.inviteCode).digest()
      : null
    const inserted = await database.pool.query<{ id: string }>(
      `INSERT INTO contests
         (title, slug, publication_status, visibility, registration_strategy, invite_required, invite_digest,
          start_at, end_at, published_at, min_team_size, max_team_size,
          registration_constraints, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               CASE WHEN $3::contest_publication_status = 'published' THEN now() ELSE NULL END,
               $10, $11, $12, $13)
       RETURNING id`,
      [
        `Participation Contest ${sequence}`,
        `participation-contest-${sequence}`,
        publicationStatus,
        options.visibility ?? (options.inviteCode ? 'private' : 'public'),
        options.strategy ?? 'review',
        Boolean(options.inviteCode),
        inviteDigest,
        startAt,
        endAt,
        options.minTeamSize ?? 1,
        options.maxTeamSize ?? 5,
        { allowed_email_domains: options.allowedEmailDomains ?? [] },
        creator.userId,
      ],
    )
    const divisions: Array<{ id: string, name: string }> = []
    for (const [sortOrder, name] of (options.divisionNames ?? []).entries()) {
      const division = await database.pool.query<{ id: string }>(
        `INSERT INTO divisions (contest_id, name, name_normalized, sort_order)
         VALUES ($1, $2::varchar(80), lower($2::text)::varchar(80), $3)
         RETURNING id`,
        [inserted.rows[0]!.id, name, sortOrder],
      )
      divisions.push({ id: division.rows[0]!.id, name })
    }
    return { id: inserted.rows[0]!.id, divisions }
  }

  async function registeredTeam(captain: SessionSubject, name: string) {
    return teams.create(captain, `${name} ${++sequence}`)
  }

  it('creates pending registrations for review and accepts eligible teams with audit evidence', async () => {
    const organizer = await user({ role: 'organizer' })
    const captain = await user()
    await registeredTeam(captain, 'Review Team')
    const target = await contest(organizer, { strategy: 'review' })

    const pending = await participations.register(captain, target.id)
    expect(pending.status).toBe('pending')
    expect(pending.reviewedAt).toBeNull()

    const accepted = await participations.review(organizer, {
      requestId: randomUUID(),
      contestId: target.id,
      participationId: pending.id,
      decision: 'accepted',
      reason: 'Eligibility reviewed',
    })
    expect(accepted.status).toBe('accepted')
    expect(accepted.reviewedAt).toBeInstanceOf(Date)

    const audit = await database.pool.query<{ action: string, outcome: string }>(
      'SELECT action, outcome FROM audit_events WHERE target_id = $1',
      [pending.id],
    )
    expect(audit.rows).toEqual([{ action: 'contest.participation.reviewed', outcome: 'succeeded' }])
  })

  it('auto-accepts eligible teams and assigns the only configured division', async () => {
    const organizer = await user({ role: 'organizer' })
    const captain = await user()
    await registeredTeam(captain, 'Automatic Team')
    const target = await contest(organizer, {
      strategy: 'auto_accept',
      divisionNames: ['Open'],
    })

    const accepted = await participations.register(captain, target.id)
    expect(accepted).toMatchObject({
      status: 'accepted',
      divisionId: target.divisions[0]!.id,
      divisionName: 'Open',
      reviewReason: 'auto_accept',
    })
    expect(accepted.reviewedAt).toBeInstanceOf(Date)
  })

  it('does not guess a division when a contest has multiple choices', async () => {
    const organizer = await user({ role: 'organizer' })
    const captain = await user()
    await registeredTeam(captain, 'Multiple Division Team')
    const target = await contest(organizer, { divisionNames: ['Open', 'Student'] })

    await expect(participations.register(captain, target.id)).resolves.toMatchObject({ divisionId: null })
  })

  it('uses indistinguishable invite failures and rechecks rotated contest invites before acceptance', async () => {
    const organizer = await user({ role: 'organizer' })
    const captain = await user()
    await registeredTeam(captain, 'Private Team')
    const firstInvite = 'contest-invite-first-value-000000000001'
    const target = await contest(organizer, { visibility: 'public', inviteCode: firstInvite })

    await expect(participations.register(captain, target.id, 'unknown-contest-invite-000000000000')).rejects.toMatchObject({
      code: 'participation.invite_invalid',
    })
    const pending = await participations.register(captain, target.id, firstInvite)
    const nextDigest = createHash('sha256').update('contest-invite-next-value-000000000002').digest()
    await database.pool.query('UPDATE contests SET invite_digest = $2 WHERE id = $1', [target.id, nextDigest])

    await expect(participations.review(organizer, {
      requestId: randomUUID(),
      contestId: target.id,
      participationId: pending.id,
      decision: 'accepted',
      reason: 'Review after invite rotation',
    })).rejects.toMatchObject({ code: 'participation.invite_invalid' })
  })

  it('does not treat a private contest identifier as registration authorization', async () => {
    const organizer = await user({ role: 'organizer' })
    const captain = await user()
    await registeredTeam(captain, 'Private Discovery Team')
    const target = await contest(organizer, { visibility: 'private' })

    await expect(participations.register(captain, target.id)).rejects.toMatchObject({
      code: 'participation.registration_closed',
    })
  })

  it('allows pending and rejected registrations to withdraw and reapply, but locks accepted registrations', async () => {
    const organizer = await user({ role: 'organizer' })
    const pendingCaptain = await user()
    await registeredTeam(pendingCaptain, 'Pending Withdrawal')
    const target = await contest(organizer)
    const pending = await participations.register(pendingCaptain, target.id)
    const withdrawn = await participations.withdraw(pendingCaptain, target.id)
    expect(withdrawn.status).toBe('withdrawn')
    await expect(participations.register(pendingCaptain, target.id)).resolves.toMatchObject({
      id: pending.id,
      status: 'pending',
      withdrawnAt: null,
    })

    const rejectedCaptain = await user()
    await registeredTeam(rejectedCaptain, 'Rejected Withdrawal')
    const rejectedPending = await participations.register(rejectedCaptain, target.id)
    await participations.review(organizer, {
      requestId: randomUUID(), contestId: target.id, participationId: rejectedPending.id,
      decision: 'rejected', reason: 'Registration rejected',
    })
    await expect(participations.withdraw(rejectedCaptain, target.id)).resolves.toMatchObject({ status: 'withdrawn' })

    const acceptedCaptain = await user()
    await registeredTeam(acceptedCaptain, 'Accepted Withdrawal')
    const automatic = await contest(organizer, { strategy: 'auto_accept' })
    await participations.register(acceptedCaptain, automatic.id)
    await expect(participations.withdraw(acceptedCaptain, automatic.id)).rejects.toMatchObject({
      code: 'participation.transition_invalid',
    })
  })

  it('rechecks team size, member security and email domains when accepting a pending registration', async () => {
    const organizer = await user({ role: 'organizer' })

    const sizeCaptain = await user()
    const sizeTeam = await registeredTeam(sizeCaptain, 'Size Team')
    const sizeContest = await contest(organizer, { maxTeamSize: 1 })
    const sizePending = await participations.register(sizeCaptain, sizeContest.id)
    const extraMember = await user()
    await teams.join(extraMember, sizeTeam.inviteCode)
    await expect(participations.review(organizer, {
      requestId: randomUUID(), contestId: sizeContest.id, participationId: sizePending.id,
      decision: 'accepted', reason: 'Review oversized team',
    })).rejects.toMatchObject({ code: 'participation.team_size_invalid' })

    const securityCaptain = await user()
    await registeredTeam(securityCaptain, 'Security Team')
    const securityContest = await contest(organizer)
    const securityPending = await participations.register(securityCaptain, securityContest.id)
    await database.pool.query('UPDATE users SET email_verified_at = NULL WHERE id = $1', [securityCaptain.userId])
    await expect(participations.review(organizer, {
      requestId: randomUUID(), contestId: securityContest.id, participationId: securityPending.id,
      decision: 'accepted', reason: 'Review unverified member',
    })).rejects.toMatchObject({ code: 'participation.member_ineligible' })
    await database.pool.query(
      'UPDATE users SET email_verified_at = now(), must_change_password = true WHERE id = $1',
      [securityCaptain.userId],
    )
    await expect(participations.review(organizer, {
      requestId: randomUUID(), contestId: securityContest.id, participationId: securityPending.id,
      decision: 'accepted', reason: 'Review setup-restricted member',
    })).rejects.toMatchObject({ code: 'participation.member_ineligible' })
    await database.pool.query(
      "UPDATE users SET must_change_password = false, status = 'banned' WHERE id = $1",
      [securityCaptain.userId],
    )
    await expect(participations.review(organizer, {
      requestId: randomUUID(), contestId: securityContest.id, participationId: securityPending.id,
      decision: 'accepted', reason: 'Review banned member',
    })).rejects.toMatchObject({ code: 'participation.member_ineligible' })

    const domainCaptain = await user({ emailDomain: 'school.test' })
    await registeredTeam(domainCaptain, 'Domain Team')
    const domainContest = await contest(organizer, { allowedEmailDomains: ['school.test'] })
    const domainPending = await participations.register(domainCaptain, domainContest.id)
    await database.pool.query(
      `UPDATE users SET email = $2::varchar(320), email_normalized = lower($2::text)::varchar(320)
       WHERE id = $1`,
      [domainCaptain.userId, `changed-${sequence}@outside.test`],
    )
    await expect(participations.review(organizer, {
      requestId: randomUUID(), contestId: domainContest.id, participationId: domainPending.id,
      decision: 'accepted', reason: 'Review changed email domain',
    })).rejects.toMatchObject({ code: 'participation.email_domain_forbidden' })
  })

  it('rejects registration and acceptance when the contest is draft or has ended', async () => {
    const organizer = await user({ role: 'organizer' })
    const draftCaptain = await user()
    await registeredTeam(draftCaptain, 'Draft Team')
    const draft = await contest(organizer, { publicationStatus: 'draft' })
    await expect(participations.register(draftCaptain, draft.id)).rejects.toMatchObject({
      code: 'participation.registration_closed',
    })

    const pendingCaptain = await user()
    await registeredTeam(pendingCaptain, 'Ending Team')
    const target = await contest(organizer)
    const pending = await participations.register(pendingCaptain, target.id)
    await database.pool.query('UPDATE contests SET end_at = now() - interval \'1 second\' WHERE id = $1', [target.id])
    await expect(participations.review(organizer, {
      requestId: randomUUID(), contestId: target.id, participationId: pending.id,
      decision: 'accepted', reason: 'Review after contest ended',
    })).rejects.toMatchObject({ code: 'participation.registration_closed' })
  })

  it('allows organizer and admin judges, rejects users, and validates division ownership', async () => {
    const organizer = await user({ role: 'organizer' })
    const adminUser = await user({ role: 'admin' })
    const ordinary = await user()
    const captain = await user()
    await registeredTeam(captain, 'Division Team')
    const target = await contest(organizer, { divisionNames: ['Open'] })
    const other = await contest(organizer, { divisionNames: ['Other'] })
    const pending = await participations.register(captain, target.id)

    await expect(participations.review(ordinary, {
      requestId: randomUUID(), contestId: target.id, participationId: pending.id,
      decision: 'accepted', reason: 'Unauthorized review',
    })).rejects.toMatchObject({ code: 'identity.capability_forbidden' })

    await participations.review(organizer, {
      requestId: randomUUID(), contestId: target.id, participationId: pending.id,
      decision: 'accepted', reason: 'Organizer review',
    })
    await expect(participations.assignDivision(adminUser, {
      requestId: randomUUID(), contestId: target.id, participationId: pending.id,
      divisionId: other.divisions[0]!.id, reason: 'Invalid external division',
    })).rejects.toMatchObject({ code: 'participation.division_invalid' })
    const assigned = await participations.assignDivision(adminUser, {
      requestId: randomUUID(), contestId: target.id, participationId: pending.id,
      divisionId: target.divisions[0]!.id, reason: 'Assign reviewed division',
    })
    expect(assigned.divisionName).toBe('Open')
  })

  it('paginates and filters the management list without leaking other contests', async () => {
    const organizer = await user({ role: 'organizer' })
    const target = await contest(organizer)
    const other = await contest(organizer)
    for (const contestId of [target.id, target.id, target.id, other.id]) {
      const captain = await user()
      await registeredTeam(captain, 'List Team')
      await participations.register(captain, contestId)
    }

    const first = await participations.list(organizer, target.id, undefined, 2, 'pending')
    expect(first.items).toHaveLength(2)
    expect(first.hasMore).toBe(true)
    expect(first.items.every(item => item.contestId === target.id)).toBe(true)
    const second = await participations.list(organizer, target.id, first.nextCursor!, 2, 'pending')
    expect(second.items).toHaveLength(1)
    expect(second.hasMore).toBe(false)
  })

  it('rolls back a review transition when its audit event cannot be committed', async () => {
    const organizer = await user({ role: 'organizer' })
    const captain = await user()
    await registeredTeam(captain, 'Atomic Audit Team')
    const target = await contest(organizer)
    const pending = await participations.register(captain, target.id)
    const requestId = randomUUID()
    await database.pool.query(
      `INSERT INTO audit_events
         (actor_user_id, action, target_type, target_id, reason, outcome, request_id, changes, metadata)
       VALUES ($1, 'contest.participation.reviewed', 'participation', $2,
               'Pre-existing audit event', 'succeeded', $3, '{}', '{}')`,
      [organizer.userId, pending.id, requestId],
    )

    await expect(participations.review(organizer, {
      requestId,
      contestId: target.id,
      participationId: pending.id,
      decision: 'accepted',
      reason: 'Eligibility reviewed',
    })).rejects.toMatchObject({ code: '23505' })
    await expect(participations.current(captain, target.id)).resolves.toMatchObject({
      participation: { status: 'pending', version: pending.version },
    })
  })

  it('serializes acceptance against membership joins so an oversized accepted team cannot emerge', async () => {
    const organizer = await user({ role: 'organizer' })
    const captain = await user()
    const newcomer = await user()
    const created = await registeredTeam(captain, 'Concurrent Team')
    const target = await contest(organizer, { maxTeamSize: 1 })
    const pending = await participations.register(captain, target.id)

    const [reviewResult, joinResult] = await Promise.allSettled([
      participations.review(organizer, {
        requestId: randomUUID(), contestId: target.id, participationId: pending.id,
        decision: 'accepted', reason: 'Concurrent eligibility review',
      }),
      teams.join(newcomer, created.inviteCode),
    ])

    const state = await database.pool.query<{ status: string, members: string }>(
      `SELECT p.status::text,
              (SELECT count(*)::text FROM team_members m WHERE m.team_id = p.team_id) AS members
       FROM participations p
       WHERE p.id = $1`,
      [pending.id],
    )
    expect(state.rows[0]).not.toEqual({ status: 'accepted', members: '2' })
    expect([reviewResult.status, joinResult.status]).toContain('rejected')
  })
})
