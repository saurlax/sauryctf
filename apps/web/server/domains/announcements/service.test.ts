import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SessionSubject } from '../identity/repository'
import { ContestService } from '../contests/service'
import { createDatabaseClient, type DatabaseClient } from '../../infrastructure/db/client'
import { runMigrations } from '../../infrastructure/db/migrate'
import { PostgresAnnouncementRepository } from '../../infrastructure/db/announcement-repository'
import { PostgresContestRepository } from '../../infrastructure/db/contest-repository'
import { createPublishableChallenge } from '../../test-support/publishable-challenge'
import { AnnouncementService } from './service'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName() {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected database name')
  return `"${databaseName}"`
}

describeWithPostgres('announcement publication lifecycle', () => {
  let admin: Client
  let database: DatabaseClient
  let announcements: AnnouncementService
  let announcementRepository: PostgresAnnouncementRepository
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
    announcementRepository = new PostgresAnnouncementRepository(database.pool)
    announcements = new AnnouncementService(announcementRepository)
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

  async function user(role: SessionSubject['role'] = 'user'): Promise<SessionSubject> {
    sequence++
    const username = `AnnouncementUser${sequence}`
    const email = `announcement-${sequence}@example.test`
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
    options: { visibility?: 'public' | 'private', timing?: 'future' | 'ended', publish?: boolean } = {},
  ) {
    sequence++
    const now = Date.now()
    const ended = options.timing === 'ended'
    const created = await contests.createDraft(organizer, {
      requestId: randomUUID(),
      title: `Announcement Contest ${sequence}`,
      slug: `announcement-contest-${sequence}`,
      description: 'Announcement lifecycle test',
      visibility: options.visibility ?? 'public',
      startAt: new Date(ended ? now - 7_200_000 : now + 3_600_000),
      endAt: new Date(ended ? now - 3_600_000 : now + 7_200_000),
    })
    await createPublishableChallenge(database.pool, created.id, organizer.userId)
    if (options.publish === false) return created
    return contests.publish(organizer, {
      requestId: randomUUID(),
      contestId: created.id,
      reason: 'Publish announcement test contest',
    })
  }

  it('creates an immediately visible announcement with transactional audit and a deduplicated event', async () => {
    const organizer = await user('organizer')
    const target = await contest(organizer)
    const requestId = randomUUID()
    const created = await announcements.create(organizer, {
      requestId,
      contestId: target.id,
      title: 'Service notice',
      body: 'The competition service is ready.',
      publishAt: new Date(Date.now() - 60_000),
    })

    expect(created).toMatchObject({ status: 'published', version: 1 })
    await expect(announcements.listPublic(target.id, undefined, 50)).resolves.toMatchObject({
      items: [expect.objectContaining({ id: created.id, title: 'Service notice' })],
    })
    const facts = await database.pool.query<{
      action: string
      request_id: string
      dedupe_key: string
      event_type: string
      event_version: number
    }>(
      `SELECT audit.action, audit.request_id, outbox.dedupe_key,
              outbox.event_type, outbox.event_version
       FROM audit_events audit
       JOIN domain_outbox outbox ON outbox.aggregate_id = audit.target_id
       WHERE audit.target_id = $1`,
      [created.id],
    )
    expect(facts.rows).toEqual([{
      action: 'contest.announcement.created',
      request_id: requestId,
      dedupe_key: `announcement:${created.id}:publication`,
      event_type: 'contest.announcement.published',
      event_version: 1,
    }])
  })

  it('keeps scheduled content private until the PostgreSQL UTC publication boundary is reached', async () => {
    const organizer = await user('organizer')
    const target = await contest(organizer)
    const publishAt = new Date(Date.now() + 250)
    const created = await announcements.create(organizer, {
      requestId: randomUUID(),
      contestId: target.id,
      title: 'Scheduled notice',
      body: 'Visible only after its publication boundary.',
      publishAt,
    })

    expect(created.status).toBe('scheduled')
    await expect(announcements.listManaged(organizer, target.id, undefined, 50)).resolves.toMatchObject({
      items: [expect.objectContaining({ id: created.id, status: 'scheduled' })],
    })
    await expect(announcements.listPublic(target.id, undefined, 50)).resolves.toMatchObject({ items: [] })

    await expect.poll(async () => {
      const page = await announcements.listPublic(target.id, undefined, 50)
      return page.items.map(item => item.id)
    }, { timeout: 2_000, interval: 25 }).toContain(created.id)
    await expect(announcementRepository.readManaged(target.id, created.id)).resolves.toMatchObject({
      status: 'published',
    })
  })

  it('reschedules an unpublished announcement without leaving a duplicate or stale publication event', async () => {
    const organizer = await user('organizer')
    const target = await contest(organizer)
    const created = await announcements.create(organizer, {
      requestId: randomUUID(),
      contestId: target.id,
      title: 'Initial schedule',
      body: 'Initial body',
      publishAt: new Date(Date.now() + 3_600_000),
    })
    const nextPublishAt = new Date(Date.now() + 7_200_000)
    const updated = await announcements.update(organizer, {
      requestId: randomUUID(),
      contestId: target.id,
      announcementId: created.id,
      expectedVersion: created.version,
      reason: 'Move publication to the confirmed slot',
      title: 'Confirmed schedule',
      body: 'Updated body',
      publishAt: nextPublishAt,
    })

    expect(updated).toMatchObject({
      title: 'Confirmed schedule', body: 'Updated body', status: 'scheduled', version: 2,
    })
    const events = await database.pool.query<{
      dedupe_key: string
      event_version: number
      available_at: Date
      payload: { announcement_version: number }
    }>(
      `SELECT dedupe_key, event_version, available_at, payload
       FROM domain_outbox WHERE aggregate_id = $1`,
      [created.id],
    )
    expect(events.rows).toHaveLength(1)
    expect(events.rows[0]).toMatchObject({
      dedupe_key: `announcement:${created.id}:publication`,
      event_version: 2,
      payload: { announcement_version: 2 },
    })
    expect(events.rows[0]!.available_at.toISOString()).toBe(nextPublishAt.toISOString())
  })

  it('uses optimistic concurrency for announcement updates', async () => {
    const organizer = await user('organizer')
    const target = await contest(organizer)
    const created = await announcements.create(organizer, {
      requestId: randomUUID(), contestId: target.id,
      title: 'Versioned notice', body: 'Version one', publishAt: new Date(Date.now() + 3_600_000),
    })
    const updated = await announcements.update(organizer, {
      requestId: randomUUID(), contestId: target.id, announcementId: created.id,
      expectedVersion: created.version, reason: 'Publish corrected wording', body: 'Version two',
    })
    expect(updated.version).toBe(2)
    await expect(announcements.update(organizer, {
      requestId: randomUUID(), contestId: target.id, announcementId: created.id,
      expectedVersion: created.version, reason: 'Attempt a stale update', body: 'Stale version',
    })).rejects.toMatchObject({ code: 'resource.version_conflict' })
    await expect(announcementRepository.readManaged(target.id, created.id)).resolves.toMatchObject({
      body: 'Version two', version: 2,
    })
  })

  it('emits versioned update events only after the publication event has been delivered', async () => {
    const organizer = await user('organizer')
    const target = await contest(organizer)
    const created = await announcements.create(organizer, {
      requestId: randomUUID(), contestId: target.id,
      title: 'Published notice', body: 'Original body', publishAt: new Date(Date.now() - 60_000),
    })
    await database.pool.query(
      `UPDATE domain_outbox SET published_at = CURRENT_TIMESTAMP
       WHERE aggregate_id = $1 AND event_type = 'contest.announcement.published'`,
      [created.id],
    )
    const updated = await announcements.update(organizer, {
      requestId: randomUUID(), contestId: target.id, announcementId: created.id,
      expectedVersion: 1, reason: 'Correct a visible announcement', body: 'Corrected body',
    })
    expect(updated.version).toBe(2)
    const events = await database.pool.query<{ event_type: string, dedupe_key: string }>(
      `SELECT event_type, dedupe_key FROM domain_outbox
       WHERE aggregate_id = $1 ORDER BY event_version, event_type`,
      [created.id],
    )
    expect(events.rows).toEqual([
      {
        event_type: 'contest.announcement.published',
        dedupe_key: `announcement:${created.id}:publication`,
      },
      {
        event_type: 'contest.announcement.updated',
        dedupe_key: `announcement:${created.id}:updated:v2`,
      },
    ])
  })

  it('withdraws a scheduled announcement without ever emitting a public publication event', async () => {
    const organizer = await user('organizer')
    const target = await contest(organizer)
    const created = await announcements.create(organizer, {
      requestId: randomUUID(), contestId: target.id,
      title: 'Cancelled schedule', body: 'This notice is cancelled.', publishAt: new Date(Date.now() + 3_600_000),
    })
    const withdrawn = await announcements.withdraw(organizer, {
      requestId: randomUUID(), contestId: target.id, announcementId: created.id,
      expectedVersion: created.version, reason: 'The maintenance window was cancelled',
    })

    expect(withdrawn).toMatchObject({ status: 'withdrawn', version: 2 })
    await expect(announcements.listPublic(target.id, undefined, 50)).resolves.toMatchObject({ items: [] })
    const events = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM domain_outbox WHERE aggregate_id = $1',
      [created.id],
    )
    expect(events.rows[0]!.count).toBe('0')
  })

  it('hides a visible withdrawal immediately, emits one event, and rejects repeated withdrawal', async () => {
    const organizer = await user('organizer')
    const target = await contest(organizer)
    const created = await announcements.create(organizer, {
      requestId: randomUUID(), contestId: target.id,
      title: 'Visible notice', body: 'Visible before withdrawal.', publishAt: new Date(Date.now() - 60_000),
    })
    const withdrawn = await announcements.withdraw(organizer, {
      requestId: randomUUID(), contestId: target.id, announcementId: created.id,
      expectedVersion: created.version, reason: 'The notice is no longer accurate',
    })

    await expect(announcements.listPublic(target.id, undefined, 50)).resolves.toMatchObject({ items: [] })
    const events = await database.pool.query<{ event_type: string, dedupe_key: string }>(
      'SELECT event_type, dedupe_key FROM domain_outbox WHERE aggregate_id = $1',
      [created.id],
    )
    expect(events.rows).toEqual([{
      event_type: 'contest.announcement.withdrawn',
      dedupe_key: `announcement:${created.id}:withdrawn:v2`,
    }])
    await expect(announcements.withdraw(organizer, {
      requestId: randomUUID(), contestId: target.id, announcementId: created.id,
      expectedVersion: withdrawn.version, reason: 'Attempt duplicate withdrawal',
    })).rejects.toMatchObject({ code: 'announcement.withdrawn' })
  })

  it('does not expose draft or private contest announcements through the public endpoint', async () => {
    const organizer = await user('organizer')
    const draft = await contest(organizer, { publish: false })
    await announcements.create(organizer, {
      requestId: randomUUID(), contestId: draft.id,
      title: 'Draft notice', body: 'Not publicly visible.', publishAt: new Date(Date.now() - 60_000),
    })
    await expect(announcements.listPublic(draft.id, undefined, 50)).rejects.toMatchObject({
      code: 'announcement.contest_not_found',
    })

    const privateContest = await contest(organizer, { visibility: 'private' })
    await announcements.create(organizer, {
      requestId: randomUUID(), contestId: privateContest.id,
      title: 'Private notice', body: 'Not publicly discoverable.', publishAt: new Date(Date.now() - 60_000),
    })
    await expect(announcements.listPublic(privateContest.id, undefined, 50)).rejects.toMatchObject({
      code: 'announcement.contest_not_found',
    })
  })

  it('rejects ordinary managers and all writes after archival', async () => {
    const organizer = await user('organizer')
    const ordinary = await user()
    const target = await contest(organizer, { timing: 'ended' })
    const created = await announcements.create(organizer, {
      requestId: randomUUID(), contestId: target.id,
      title: 'Archive notice', body: 'Created before archival.', publishAt: new Date(Date.now() - 60_000),
    })
    await expect(announcements.create(ordinary, {
      requestId: randomUUID(), contestId: target.id,
      title: 'Unauthorized notice', body: 'Must not be written.', publishAt: new Date(),
    })).rejects.toMatchObject({ code: 'identity.capability_forbidden' })

    await contests.archive(organizer, {
      requestId: randomUUID(), contestId: target.id, reason: 'Archive completed contest',
    })
    await expect(announcements.create(organizer, {
      requestId: randomUUID(), contestId: target.id,
      title: 'Late notice', body: 'Must not be written.', publishAt: new Date(),
    })).rejects.toMatchObject({ code: 'announcement.contest_archived' })
    await expect(announcements.update(organizer, {
      requestId: randomUUID(), contestId: target.id, announcementId: created.id,
      expectedVersion: created.version, reason: 'Attempt archived update', body: 'Changed',
    })).rejects.toMatchObject({ code: 'announcement.contest_archived' })
    await expect(announcements.withdraw(organizer, {
      requestId: randomUUID(), contestId: target.id, announcementId: created.id,
      expectedVersion: created.version, reason: 'Attempt archived withdrawal',
    })).rejects.toMatchObject({ code: 'announcement.contest_archived' })
  })

  it('rolls back the announcement and outbox when immutable create audit insertion fails', async () => {
    const organizer = await user('organizer')
    const target = await contest(organizer)
    const announcementId = randomUUID()
    const requestId = randomUUID()
    await database.pool.query(
      `INSERT INTO audit_events
         (actor_user_id, action, target_type, target_id, reason,
          outcome, request_id, changes, metadata)
       VALUES ($1, 'contest.announcement.created', 'announcement', $2,
               'Existing event', 'succeeded', $3, '{}', '{}')`,
      [organizer.userId, announcementId, requestId],
    )

    await expect(announcementRepository.create({
      announcementId,
      actorId: organizer.userId,
      requestId,
      contestId: target.id,
      title: 'Atomic create',
      body: 'Must roll back with audit failure.',
      publishAt: new Date(Date.now() - 60_000),
    })).rejects.toMatchObject({ code: '23505' })
    const counts = await database.pool.query<{ announcements: string, outbox: string }>(
      `SELECT
         (SELECT count(*)::text FROM announcements WHERE id = $1) AS announcements,
         (SELECT count(*)::text FROM domain_outbox WHERE aggregate_id = $1) AS outbox`,
      [announcementId],
    )
    expect(counts.rows[0]).toEqual({ announcements: '0', outbox: '0' })
  })

  it('rolls back update facts and event replacement when immutable audit insertion fails', async () => {
    const organizer = await user('organizer')
    const target = await contest(organizer)
    const created = await announcements.create(organizer, {
      requestId: randomUUID(), contestId: target.id,
      title: 'Atomic update', body: 'Original body', publishAt: new Date(Date.now() + 3_600_000),
    })
    const requestId = randomUUID()
    await database.pool.query(
      `INSERT INTO audit_events
         (actor_user_id, action, target_type, target_id, reason,
          outcome, request_id, changes, metadata)
       VALUES ($1, 'contest.announcement.updated', 'announcement', $2,
               'Existing event', 'succeeded', $3, '{}', '{}')`,
      [organizer.userId, created.id, requestId],
    )

    await expect(announcements.update(organizer, {
      requestId, contestId: target.id, announcementId: created.id,
      expectedVersion: created.version, reason: 'Update with duplicate audit',
      title: 'Must roll back', publishAt: new Date(Date.now() + 7_200_000),
    })).rejects.toMatchObject({ code: '23505' })
    await expect(announcementRepository.readManaged(target.id, created.id)).resolves.toMatchObject({
      title: 'Atomic update', version: 1,
    })
    const events = await database.pool.query<{
      count: string
      event_version: number
    }>(
      `SELECT count(*)::text AS count, max(event_version)::integer AS event_version
       FROM domain_outbox WHERE aggregate_id = $1`,
      [created.id],
    )
    expect(events.rows[0]).toEqual({ count: '1', event_version: 1 })
  })

  it('paginates managed and public lists with stable announcement cursors', async () => {
    const organizer = await user('organizer')
    const target = await contest(organizer)
    for (const index of [1, 2, 3]) {
      await announcements.create(organizer, {
        requestId: randomUUID(), contestId: target.id,
        title: `Page notice ${index}`, body: `Page body ${index}`,
        publishAt: new Date(Date.now() - index * 60_000),
      })
    }
    const first = await announcements.listManaged(organizer, target.id, undefined, 2)
    expect(first.items).toHaveLength(2)
    expect(first).toMatchObject({ hasMore: true, nextCursor: expect.any(String) })
    const second = await announcements.listManaged(organizer, target.id, first.nextCursor!, 2)
    expect(second.items).toHaveLength(1)
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(3)

    const publicFirst = await announcements.listPublic(target.id, undefined, 2)
    const publicSecond = await announcements.listPublic(target.id, publicFirst.nextCursor!, 2)
    expect(new Set([...publicFirst.items, ...publicSecond.items].map(item => item.id)).size).toBe(3)
  })
})
