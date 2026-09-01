import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SessionSubject } from '../identity/repository'
import { AnnouncementService } from '../announcements/service'
import { ContestService } from '../contests/service'
import { createDatabaseClient, type DatabaseClient } from '../../infrastructure/db/client'
import { runMigrations } from '../../infrastructure/db/migrate'
import { PostgresAnnouncementRepository } from '../../infrastructure/db/announcement-repository'
import { PostgresContestRepository } from '../../infrastructure/db/contest-repository'
import { PostgresPublicTimelineRepository } from '../../infrastructure/db/public-timeline-repository'
import { PublicTimelineService } from './service'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName() {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected database name')
  return `"${databaseName}"`
}

describeWithPostgres('selected public contest timeline', () => {
  let admin: Client
  let database: DatabaseClient
  let timeline: PublicTimelineService
  let contests: ContestService
  let announcements: AnnouncementService
  let sequence = 0

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 12 })
    await runMigrations(database)
    timeline = new PublicTimelineService(new PostgresPublicTimelineRepository(database.pool))
    contests = new ContestService(new PostgresContestRepository(database.pool))
    announcements = new AnnouncementService(new PostgresAnnouncementRepository(database.pool))
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
    const username = `TimelineUser${sequence}`
    const email = `timeline-${sequence}@example.test`
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

  async function contest(
    organizer: SessionSubject,
    options: {
      visibility?: 'public' | 'private'
      phase?: 'upcoming' | 'running' | 'ended'
      publish?: boolean
      freeze?: boolean
    } = {},
  ) {
    sequence++
    const now = Date.now()
    const phase = options.phase ?? 'upcoming'
    const windows = {
      upcoming: [now + 3_600_000, now + 7_200_000],
      running: [now - 7_200_000, now + 7_200_000],
      ended: [now - 7_200_000, now - 3_600_000],
    } as const
    const created = await contests.createDraft(organizer, {
      requestId: randomUUID(),
      title: `Timeline Contest ${sequence}`,
      slug: `timeline-contest-${sequence}`,
      description: 'Public timeline test contest',
      visibility: options.visibility ?? 'public',
      startAt: new Date(windows[phase][0]),
      endAt: new Date(windows[phase][1]),
      scoreboardFreezeAt: options.freeze ? new Date(now - 3_600_000) : null,
    })
    if (options.publish === false) return created
    return contests.publish(organizer, {
      requestId: randomUUID(),
      contestId: created.id,
      reason: 'Publish timeline test contest',
    })
  }

  it('projects announcements and phase changes while excluding management audit facts', async () => {
    const organizer = await user()
    const target = await contest(organizer)
    const announcement = await announcements.create(organizer, {
      requestId: randomUUID(),
      contestId: target.id,
      title: 'Opening notice',
      body: 'Registration remains available.',
      publishAt: new Date(Date.now() - 60_000),
    })
    await database.pool.query(
      `INSERT INTO audit_events
         (actor_user_id, action, target_type, target_id, reason,
          outcome, request_id, changes, metadata)
       VALUES ($1, 'contest.configuration_updated', 'contest', $2,
               'Management-only fact', 'succeeded', $3, '{}', '{}')`,
      [organizer.userId, target.id, randomUUID()],
    )

    const page = await timeline.listPublic(target.id, undefined, 50)
    expect(page.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `announcement:${announcement.id}:published`,
        eventType: 'announcement_published',
        payload: { announcement_id: announcement.id, title: 'Opening notice' },
      }),
      expect.objectContaining({
        id: 'contest:phase:upcoming',
        eventType: 'contest_phase_changed',
        payload: { phase: 'upcoming' },
      }),
    ]))
    expect(JSON.stringify(page.items)).not.toContain('configuration_updated')
    expect(JSON.stringify(page.items)).not.toContain('Management-only fact')
  })

  it('shows scheduled announcements only after their UTC boundary and hides withdrawals', async () => {
    const organizer = await user()
    const target = await contest(organizer)
    const scheduled = await announcements.create(organizer, {
      requestId: randomUUID(),
      contestId: target.id,
      title: 'Scheduled timeline notice',
      body: 'Appears at the configured instant.',
      publishAt: new Date(Date.now() + 250),
    })
    const before = await timeline.listPublic(target.id, undefined, 50)
    expect(before.items.map(item => item.id)).not.toContain(`announcement:${scheduled.id}:published`)

    await expect.poll(async () => {
      const page = await timeline.listPublic(target.id, undefined, 50)
      return page.items.map(item => item.id)
    }, { timeout: 2_000, interval: 25 }).toContain(`announcement:${scheduled.id}:published`)

    await announcements.withdraw(organizer, {
      requestId: randomUUID(),
      contestId: target.id,
      announcementId: scheduled.id,
      expectedVersion: scheduled.version,
      reason: 'Remove the published notice from the public timeline',
    })
    const after = await timeline.listPublic(target.id, undefined, 50)
    expect(after.items.map(item => item.id)).not.toContain(`announcement:${scheduled.id}:published`)
  })

  it('publishes only the selected challenge, hint and first-solve event types with stable keys', async () => {
    const organizer = await user()
    const target = await contest(organizer)
    const challengeId = randomUUID()
    const hintId = randomUUID()
    const teamId = randomUUID()
    await database.pool.query(
      `INSERT INTO contest_events
         (contest_id, event_type, event_key, occurred_at, visible_at, payload)
       VALUES
         ($1, 'challenge_published', $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $3),
         ($1, 'hint_published', $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $5),
         ($1, 'first_solve', $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $7)`,
      [
        target.id,
        `challenge:${challengeId}:published`,
        { challenge_id: challengeId, title: 'Web Entry', category: 'web' },
        `hint:${hintId}:published`,
        { challenge_id: challengeId, hint_id: hintId },
        `challenge:${challengeId}:first-solve`,
        { challenge_id: challengeId, team_id: teamId, team_name: 'First Team' },
      ],
    )

    const page = await timeline.listPublic(target.id, undefined, 50)
    const explicit = page.items.filter(item => [
      'challenge_published', 'hint_published', 'first_solve',
    ].includes(item.eventType))
    expect(explicit.map(item => item.eventType).sort()).toEqual([
      'challenge_published', 'first_solve', 'hint_published',
    ])
    expect(new Set(explicit.map(item => item.id)).size).toBe(3)

    await expect(database.pool.query(
      `INSERT INTO contest_events (contest_id, event_type, event_key, payload)
       VALUES ($1, 'challenge_published', $2, $3)`,
      [target.id, `challenge:${challengeId}:published`, { challenge_id: challengeId }],
    )).rejects.toMatchObject({ code: '23505' })
    await expect(database.pool.query(
      `INSERT INTO contest_events (contest_id, event_type, event_key)
       VALUES ($1, 'contest_configuration_updated', 'management-event')`,
      [target.id],
    )).rejects.toMatchObject({ code: '22P02' })
  })

  it('keeps future selected events hidden until visible_at', async () => {
    const organizer = await user()
    const target = await contest(organizer)
    const challengeId = randomUUID()
    await database.pool.query(
      `INSERT INTO contest_events
         (contest_id, event_type, event_key, occurred_at, visible_at, payload)
       VALUES ($1, 'challenge_published', $2, CURRENT_TIMESTAMP,
               CURRENT_TIMESTAMP + interval '1 hour', $3)`,
      [
        target.id,
        `challenge:${challengeId}:published`,
        { challenge_id: challengeId, title: 'Hidden Challenge', category: 'misc' },
      ],
    )
    const page = await timeline.listPublic(target.id, undefined, 50)
    expect(page.items.map(item => item.id)).not.toContain(`challenge:${challengeId}:published`)
  })

  it('derives freeze and phase events and delays post-freeze first solves until contest end', async () => {
    const organizer = await user()
    const target = await contest(organizer, { phase: 'running', freeze: true })
    const challengeId = randomUUID()
    const teamId = randomUUID()
    await database.pool.query(
      `INSERT INTO contest_events
         (contest_id, event_type, event_key, occurred_at, visible_at, payload)
       VALUES ($1, 'first_solve', $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $3)`,
      [
        target.id,
        `challenge:${challengeId}:first-solve`,
        { challenge_id: challengeId, team_id: teamId, team_name: 'Frozen Team' },
      ],
    )
    const frozen = await timeline.listPublic(target.id, undefined, 50)
    expect(frozen.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'scoreboard_frozen' }),
      expect.objectContaining({ eventType: 'contest_phase_changed', payload: { phase: 'running' } }),
    ]))
    expect(frozen.items.map(item => item.eventType)).not.toContain('first_solve')

    await database.pool.query(
      `UPDATE contests SET end_at = CURRENT_TIMESTAMP - interval '1 second'
       WHERE id = $1`,
      [target.id],
    )
    const ended = await timeline.listPublic(target.id, undefined, 50)
    expect(ended.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'first_solve' }),
      expect.objectContaining({ eventType: 'contest_phase_changed', payload: { phase: 'ended' } }),
    ]))
  })

  it('does not disclose draft or private contest timelines', async () => {
    const organizer = await user()
    const draft = await contest(organizer, { publish: false })
    await expect(timeline.listPublic(draft.id, undefined, 50)).rejects.toMatchObject({
      code: 'timeline.contest_not_found',
    })
    const privateContest = await contest(organizer, { visibility: 'private' })
    await expect(timeline.listPublic(privateContest.id, undefined, 50)).rejects.toMatchObject({
      code: 'timeline.contest_not_found',
    })
  })

  it('paginates the mixed timeline with an opaque stable cursor and rejects tampering', async () => {
    const organizer = await user()
    const target = await contest(organizer)
    for (const index of [1, 2, 3]) {
      await announcements.create(organizer, {
        requestId: randomUUID(),
        contestId: target.id,
        title: `Timeline page ${index}`,
        body: `Timeline body ${index}`,
        publishAt: new Date(Date.now() - index * 60_000),
      })
    }
    const first = await timeline.listPublic(target.id, undefined, 2)
    expect(first).toMatchObject({ items: expect.any(Array), hasMore: true, nextCursor: expect.any(String) })
    expect(first.items).toHaveLength(2)
    const second = await timeline.listPublic(target.id, first.nextCursor!, 2)
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(4)

    await expect(timeline.listPublic(target.id, 'not-a-cursor', 2)).rejects.toMatchObject({
      code: 'timeline.cursor_invalid',
    })
  })
})
