import { randomBytes, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { createClient } from 'redis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AnnouncementService } from '../../domains/announcements/service'
import { ContestService } from '../../domains/contests/service'
import type { DomainEvent } from '../../domains/events/domain-outbox'
import { ScoreboardBuildCoordinator } from '../../domains/scoreboards/build-coordinator'
import { cacheDescriptor } from '../../domains/scoreboards/cache'
import { ScoreboardViewService } from '../../domains/scoreboards/view-service'
import { ContestScoringReplayService } from '../../domains/submissions/scoring-replay'
import { PublicTimelineService } from '../../domains/timeline/service'
import { ResilientRedisScoreboardBuildLock } from '../cache/redis-scoreboard-build-lock'
import { ResilientRedisScoreboardCache } from '../cache/redis-scoreboard-cache'
import { PostgresAnnouncementRepository } from '../db/announcement-repository'
import { createDatabaseClient, type DatabaseClient } from '../db/client'
import { PostgresContestRepository } from '../db/contest-repository'
import { runMigrations } from '../db/migrate'
import { PostgresPublicTimelineRepository } from '../db/public-timeline-repository'
import { PostgresScoreboardViewRepository } from '../db/scoreboard-view-repository'
import { PostgresScoringReplayRepository } from '../db/scoring-replay-repository'
import { RedisDomainEventPublisher } from '../events/redis-domain-event-publisher'
import { RedisPublicRealtimeLog } from '../events/redis-public-realtime-log'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const configuredRedisUrl = process.env.TEST_REDIS_URL
const describeWithInfrastructure = adminConnectionString && configuredRedisUrl ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`
const currentTime = new Date('2026-09-02T08:00:00.000Z')

function quotedDatabaseName() {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected database name')
  return `"${databaseName}"`
}

function isolatedRedisUrl(redisUrl: string) {
  const parsed = new URL(redisUrl)
  parsed.pathname = '/15'
  return parsed.toString()
}

function scoreboardEvent(contestId: string, version: number): DomainEvent {
  return {
    schema: 'domain-event.v1',
    id: randomUUID(),
    aggregateType: 'contest',
    aggregateId: contestId,
    eventType: 'scoreboard.version_changed',
    eventVersion: 1,
    payload: { contest_id: contestId, version },
    occurredAt: currentTime.toISOString(),
  }
}

describeWithInfrastructure('Redis authority-loss recovery', () => {
  let admin: Client
  let database: DatabaseClient
  let redis: ReturnType<typeof createClient>
  let redisUrl: string
  let organizerId: string
  let publicContestId: string
  let privateContestId: string
  let challengeId: string
  let participationId: string
  let instanceId: string

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const databaseUrl = new URL(adminConnectionString!)
    databaseUrl.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: databaseUrl.toString(), maxConnections: 8 })
    await runMigrations(database)

    redisUrl = isolatedRedisUrl(configuredRedisUrl!)
    redis = createClient({ url: redisUrl })
    redis.on('error', () => {})
    await redis.connect()
    await redis.flushDb()

    const organizer = await database.pool.query<{ id: string }>(
      `INSERT INTO users
         (username, username_normalized, email, email_normalized,
          email_verified_at, session_version)
       VALUES ('RecoveryOrganizer', 'recoveryorganizer',
               'recovery-organizer@example.test', 'recovery-organizer@example.test',
               $1, 7)
       RETURNING id`,
      [new Date('2026-09-01T00:00:00.000Z')],
    )
    organizerId = organizer.rows[0]!.id
    await database.pool.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'organizer')`,
      [organizerId],
    )
    const player = await database.pool.query<{ id: string }>(
      `INSERT INTO users
         (username, username_normalized, email, email_normalized, email_verified_at)
       VALUES ('RecoveryPlayer', 'recoveryplayer',
               'recovery-player@example.test', 'recovery-player@example.test', $1)
       RETURNING id`,
      [new Date('2026-09-01T00:00:00.000Z')],
    )
    const playerId = player.rows[0]!.id
    await database.pool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'user')`, [playerId])

    const publicContest = await database.pool.query<{ id: string }>(
      `INSERT INTO contests
         (title, slug, description, publication_status, visibility,
          start_at, end_at, registration_constraints, created_by)
       VALUES ('Recovery Contest', $1, 'Redis recovery fixture', 'draft', 'public',
               $2, $3, '{"allowed_email_domains":[]}', $4)
       RETURNING id`,
      [
        `recovery-${randomUUID()}`,
        new Date('2026-09-02T07:00:00.000Z'),
        new Date('2026-09-02T09:00:00.000Z'),
        organizerId,
      ],
    )
    publicContestId = publicContest.rows[0]!.id
    const privateContest = await database.pool.query<{ id: string }>(
      `INSERT INTO contests
         (title, slug, description, publication_status, visibility,
          start_at, end_at, registration_constraints, published_at, created_by)
       VALUES ('Private Recovery Contest', $1, '', 'published', 'private',
               $2, $3, '{"allowed_email_domains":[]}', $4, $5)
       RETURNING id`,
      [
        `private-recovery-${randomUUID()}`,
        new Date('2026-09-02T07:00:00.000Z'),
        new Date('2026-09-02T09:00:00.000Z'),
        new Date('2026-09-01T12:00:00.000Z'),
        organizerId,
      ],
    )
    privateContestId = privateContest.rows[0]!.id

    const teamConnection = await database.pool.connect()
    let teamId: string
    try {
      await teamConnection.query('BEGIN')
      const team = await teamConnection.query<{ id: string }>(
        `INSERT INTO teams (name, name_normalized, created_by)
         VALUES ('Recovery Team', 'recovery team', $1) RETURNING id`,
        [playerId],
      )
      teamId = team.rows[0]!.id
      await teamConnection.query(
        `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'captain')`,
        [teamId, playerId],
      )
      await teamConnection.query('COMMIT')
    }
    catch (error) {
      await teamConnection.query('ROLLBACK')
      throw error
    }
    finally {
      teamConnection.release()
    }
    const participation = await database.pool.query<{ id: string }>(
      `INSERT INTO participations
         (contest_id, team_id, status, registered_by, reviewed_by, reviewed_at)
       VALUES ($1, $2, 'accepted', $3, $4, $5) RETURNING id`,
      [publicContestId, teamId, playerId, organizerId, new Date('2026-09-01T12:30:00.000Z')],
    )
    participationId = participation.rows[0]!.id

    const template = await database.pool.query<{ id: string }>(
      `INSERT INTO challenge_templates (name, slug, created_by)
       VALUES ('Recovery Template', $1, $2) RETURNING id`,
      [`recovery-template-${randomUUID()}`, organizerId],
    )
    const templateId = template.rows[0]!.id
    const templateVersion = await database.pool.query<{ id: string }>(
      `INSERT INTO challenge_template_versions
         (template_id, version_number, title, category, description,
          flag_policy, scoring_policy, instance_policy, created_by)
       VALUES ($1, 1, 'Recovery Challenge', 'misc', 'Statement',
               '{"type":"static","digest":"masked"}',
               '{"type":"fixed-v1","points":500}',
               '{"type":"dynamic","provider":"docker","image":"example/challenge:1"}', $2)
       RETURNING id`,
      [templateId, organizerId],
    )
    const challenge = await database.pool.query<{ id: string }>(
      `INSERT INTO contest_challenges
         (contest_id, source_template_id, source_version_id, title, category,
          description, flag_policy, scoring_policy, instance_policy, enabled, publish_at)
       VALUES ($1, $2, $3, 'Recovery Challenge', 'misc', 'Statement',
               '{"type":"static","digest":"masked"}',
               '{"type":"fixed-v1","points":500}',
               '{"type":"dynamic","provider":"docker","image":"example/challenge:1"}', true, $4)
       RETURNING id`,
      [publicContestId, templateId, templateVersion.rows[0]!.id, new Date('2026-09-02T07:00:00.000Z')],
    )
    challengeId = challenge.rows[0]!.id
    await database.pool.query(
      `UPDATE contests
       SET publication_status = 'published', published_at = $2, updated_at = $2
       WHERE id = $1`,
      [publicContestId, new Date('2026-09-01T12:00:00.000Z')],
    )

    await database.pool.query(
      `INSERT INTO announcements (contest_id, title, body, publish_at, created_by)
       VALUES ($1, 'Recovery announcement', 'Public body', $2, $3)`,
      [publicContestId, new Date('2026-09-01T13:10:00.000Z'), organizerId],
    )
    await database.pool.query(
      `INSERT INTO contest_events
         (contest_id, event_type, event_key, occurred_at, visible_at, payload)
       VALUES ($1, 'challenge_published', $2, $3, $3,
               jsonb_build_object('challenge_id', $4::uuid,
                                  'title', 'Recovery Challenge', 'category', 'misc'))`,
      [
        publicContestId,
        `challenge:${challengeId}:published`,
        new Date('2026-09-01T13:00:00.000Z'),
        challengeId,
      ],
    )

    const submission = await database.pool.query<{ id: string }>(
      `INSERT INTO submissions
         (contest_id, contest_challenge_id, participation_id, user_id, mode,
          result, answer_digest, answer_ciphertext, request_id, submitted_at)
       VALUES ($1, $2, $3, $4, 'official', 'correct', $5, $6, $7, $8)
       RETURNING id`,
      [
        publicContestId,
        challengeId,
        participationId,
        playerId,
        randomBytes(32),
        randomBytes(33),
        randomUUID(),
        new Date('2026-09-02T07:30:00.000Z'),
      ],
    )
    await database.pool.query(
      `INSERT INTO solves
         (submission_id, contest_id, contest_challenge_id, participation_id,
          mode, awarded_score, solve_order, solved_at)
       VALUES ($1, $2, $3, $4, 'official', 500, 1, $5)`,
      [
        submission.rows[0]!.id,
        publicContestId,
        challengeId,
        participationId,
        new Date('2026-09-02T07:30:00.000Z'),
      ],
    )
    await database.pool.query(
      `INSERT INTO scoreboard_versions (contest_id, version, updated_at) VALUES ($1, 1, $2)`,
      [publicContestId, new Date('2026-09-02T07:30:00.000Z')],
    )

    const instance = await database.pool.query<{ id: string }>(
      `INSERT INTO instances
         (contest_id, contest_challenge_id, participation_id, provider,
          desired_state, desired_generation, observed_state, observed_generation,
          expires_at, provider_resource_id, entrypoints, access_ciphertext,
          last_observed_at, version)
       VALUES ($1, $2, $3, 'docker', 'running', 4, 'running', 4,
               $4, 'recovery-container',
               '[{"type":"http","url":"https://challenge.example.test"}]',
               $5, $6, 3)
       RETURNING id`,
      [
        publicContestId,
        challengeId,
        participationId,
        new Date('2026-09-02T08:30:00.000Z'),
        randomBytes(48),
        new Date('2026-09-02T07:59:00.000Z'),
      ],
    )
    instanceId = instance.rows[0]!.id
    await database.pool.query(
      `INSERT INTO instance_jobs
         (instance_id, operation, payload_version, payload, desired_generation,
          idempotency_key, status, available_at, fencing_token, attempt_count,
          max_attempts, started_at, finished_at)
       VALUES ($1, 'ensure', 1, '{"schema":"instance-job.v1"}', 4,
               $2, 'succeeded', $3, 2, 1, 8, $3, $4)`,
      [
        instanceId,
        `recovery-instance:${instanceId}:generation:4:ensure`,
        new Date('2026-09-02T07:55:00.000Z'),
        new Date('2026-09-02T07:59:00.000Z'),
      ],
    )
  })

  afterAll(async () => {
    if (redis?.isOpen) {
      await redis.flushDb()
      redis.destroy()
    }
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

  it('rebuilds public projections without changing PostgreSQL authority facts', async () => {
    const contests = new ContestService(new PostgresContestRepository(database.pool))
    const announcements = new AnnouncementService(new PostgresAnnouncementRepository(database.pool))
    const timeline = new PublicTimelineService(new PostgresPublicTimelineRepository(database.pool))
    const scoreboardRepository = new PostgresScoreboardViewRepository(database.pool)
    const replays = new ContestScoringReplayService(new PostgresScoringReplayRepository(database.pool))
    const firstCache = new ResilientRedisScoreboardCache(redisUrl)
    const firstLock = new ResilientRedisScoreboardBuildLock(redisUrl)
    const firstScoreboards = new ScoreboardViewService(
      scoreboardRepository,
      replays,
      undefined,
      () => currentTime,
      firstCache,
      new ScoreboardBuildCoordinator(firstLock),
    )
    const publisher = new RedisDomainEventPublisher(redisUrl)
    const realtime = new RedisPublicRealtimeLog(redisUrl)
    let rebuiltCache: ResilientRedisScoreboardCache | undefined
    let rebuiltLock: ResilientRedisScoreboardBuildLock | undefined
    try {
      const publicContestBefore = await contests.readPublic(publicContestId)
      const announcementsBefore = await announcements.listPublic(publicContestId, undefined, 50)
      const timelineBefore = await timeline.listPublic(publicContestId, undefined, 50)
      expect(announcementsBefore.items).toEqual([
        expect.objectContaining({ title: 'Recovery announcement', status: 'published' }),
      ])
      expect(timelineBefore.items).toContainEqual(expect.objectContaining({
        id: `challenge:${challengeId}:published`,
        eventType: 'challenge_published',
      }))
      const scoreboardBefore = await firstScoreboards.read({
        contestId: publicContestId,
        view: 'public',
        viewerRole: 'user',
        scope: { type: 'overall' },
      })
      expect(scoreboardBefore.board.rows).toEqual([
        expect.objectContaining({ participationId, totalPoints: 500, officialSolveCount: 1 }),
      ])
      expect(await firstCache.get(cacheDescriptor(scoreboardBefore))).toEqual(scoreboardBefore)

      const firstRealtimeEvent = scoreboardEvent(publicContestId, 1)
      const secondRealtimeEvent = scoreboardEvent(publicContestId, 1)
      await publisher.publish(firstRealtimeEvent)
      await publisher.publish(secondRealtimeEvent)
      await expect(realtime.recover(publicContestId, firstRealtimeEvent.id)).resolves.toEqual({
        status: 'recovered',
        events: [expect.objectContaining({ id: secondRealtimeEvent.id, version: 1 })],
      })

      await expect(contests.readPublic(privateContestId)).rejects.toMatchObject({ code: 'contest.not_found' })
      await expect(firstScoreboards.read({
        contestId: publicContestId,
        view: 'internal',
        viewerRole: 'user',
        scope: { type: 'overall' },
      })).rejects.toMatchObject({ code: 'scoreboard.internal_forbidden' })

      const authorityBefore = await authoritySnapshot(database, organizerId, publicContestId, instanceId)
      await redis.flushDb()

      expect(await firstCache.get(cacheDescriptor(scoreboardBefore))).toBeNull()
      await expect(realtime.recover(publicContestId, firstRealtimeEvent.id)).resolves.toEqual({ status: 'reset' })

      rebuiltCache = new ResilientRedisScoreboardCache(redisUrl)
      rebuiltLock = new ResilientRedisScoreboardBuildLock(redisUrl)
      const rebuiltScoreboards = new ScoreboardViewService(
        scoreboardRepository,
        replays,
        undefined,
        () => currentTime,
        rebuiltCache,
        new ScoreboardBuildCoordinator(rebuiltLock),
      )
      const scoreboardAfter = await rebuiltScoreboards.read({
        contestId: publicContestId,
        view: 'public',
        viewerRole: 'user',
        scope: { type: 'overall' },
      })
      expect(scoreboardAfter).toEqual(scoreboardBefore)
      expect(await rebuiltCache.get(cacheDescriptor(scoreboardAfter))).toEqual(scoreboardAfter)

      expect(await contests.readPublic(publicContestId)).toEqual(publicContestBefore)
      expect(await announcements.listPublic(publicContestId, undefined, 50)).toEqual(announcementsBefore)
      expect(await timeline.listPublic(publicContestId, undefined, 50)).toEqual(timelineBefore)
      await expect(contests.readPublic(privateContestId)).rejects.toMatchObject({ code: 'contest.not_found' })
      await expect(rebuiltScoreboards.read({
        contestId: publicContestId,
        view: 'internal',
        viewerRole: 'user',
        scope: { type: 'overall' },
      })).rejects.toMatchObject({ code: 'scoreboard.internal_forbidden' })

      const resumedEvent = scoreboardEvent(publicContestId, 1)
      const followingEvent = scoreboardEvent(publicContestId, 1)
      await publisher.publish(resumedEvent)
      await publisher.publish(followingEvent)
      await expect(realtime.recover(publicContestId, resumedEvent.id)).resolves.toEqual({
        status: 'recovered',
        events: [expect.objectContaining({ id: followingEvent.id, version: 1 })],
      })

      expect(await authoritySnapshot(database, organizerId, publicContestId, instanceId))
        .toEqual(authorityBefore)
    }
    finally {
      await firstCache.close()
      await firstLock.close()
      await rebuiltCache?.close()
      await rebuiltLock?.close()
      await publisher.close()
      await realtime.close()
    }
  })

  it('serves one merged PostgreSQL rebuild while Redis is unreachable and repopulates cache after recovery', async () => {
    await database.pool.query(
      `DELETE FROM scoreboard_snapshots WHERE contest_id = $1`,
      [publicContestId],
    )
    const repository = new PostgresScoreboardViewRepository(database.pool)
    const authoritativeReplays = new ContestScoringReplayService(
      new PostgresScoringReplayRepository(database.pool),
    )
    let replayCount = 0
    const replays = {
      replay: async (...args: Parameters<ContestScoringReplayService['replay']>) => {
        replayCount++
        return authoritativeReplays.replay(...args)
      },
    }
    const unavailableRedisUrl = 'redis://127.0.0.1:1'
    const unavailableCache = new ResilientRedisScoreboardCache(unavailableRedisUrl)
    const unavailableLock = new ResilientRedisScoreboardBuildLock(unavailableRedisUrl)
    const degraded = new ScoreboardViewService(
      repository,
      replays,
      undefined,
      () => currentTime,
      unavailableCache,
      new ScoreboardBuildCoordinator(unavailableLock),
    )
    const authorityBefore = await authoritySnapshot(database, organizerId, publicContestId, instanceId)
    try {
      const reads = await Promise.all(Array.from({ length: 64 }, () => degraded.read({
        contestId: publicContestId,
        view: 'public',
        viewerRole: 'user',
        scope: { type: 'overall' },
      })))
      expect(replayCount).toBe(1)
      expect(reads.every(read => read.version === 1 && read.board.rows[0]?.totalPoints === 500)).toBe(true)
      await expect(degraded.read({
        contestId: publicContestId,
        view: 'internal',
        viewerRole: 'user',
        scope: { type: 'overall' },
      })).rejects.toMatchObject({ code: 'scoreboard.internal_forbidden' })

      const snapshots = await database.pool.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM scoreboard_snapshots
        WHERE contest_id = $1 AND view = 'public'`, [publicContestId])
      expect(snapshots.rows[0]?.count).toBe(1)
      expect(await authoritySnapshot(database, organizerId, publicContestId, instanceId))
        .toEqual(authorityBefore)
    }
    finally {
      await unavailableCache.close()
      await unavailableLock.close()
    }

    const recoveredCache = new ResilientRedisScoreboardCache(redisUrl)
    const recoveredLock = new ResilientRedisScoreboardBuildLock(redisUrl)
    try {
      const recovered = new ScoreboardViewService(
        repository,
        authoritativeReplays,
        undefined,
        () => currentTime,
        recoveredCache,
        new ScoreboardBuildCoordinator(recoveredLock),
      )
      const projection = await recovered.read({
        contestId: publicContestId,
        view: 'public',
        viewerRole: 'user',
        scope: { type: 'overall' },
      })
      expect(await recoveredCache.get(cacheDescriptor(projection))).toEqual(projection)
    }
    finally {
      await recoveredCache.close()
      await recoveredLock.close()
    }
  }, 20_000)
})

async function authoritySnapshot(
  database: DatabaseClient,
  organizerId: string,
  contestId: string,
  instanceId: string,
) {
  const identity = await database.pool.query(
    `SELECT u.id, u.status::text, u.session_version::text, ur.role::text
     FROM users u JOIN user_roles ur ON ur.user_id = u.id
     WHERE u.id = $1`,
    [organizerId],
  )
  const scoring = await database.pool.query(
    `SELECT count(*)::text AS solve_count,
            coalesce(sum(awarded_score), 0)::text AS awarded_score
     FROM solves WHERE contest_id = $1 AND mode = 'official'`,
    [contestId],
  )
  const instance = await database.pool.query(
    `SELECT i.id, i.contest_id, i.contest_challenge_id, i.participation_id,
            i.desired_state::text, i.desired_generation::text,
            i.observed_state::text, i.observed_generation::text,
            i.provider_resource_id, i.version::text,
            j.operation::text, j.status::text, j.fencing_token::text,
            j.attempt_count::text
     FROM instances i JOIN instance_jobs j ON j.instance_id = i.id
     WHERE i.id = $1`,
    [instanceId],
  )
  return {
    identity: identity.rows,
    scoring: scoring.rows,
    instance: instance.rows,
  }
}
