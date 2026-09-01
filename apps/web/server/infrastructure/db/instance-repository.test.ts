import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPublishableChallenge } from '../../test-support/publishable-challenge'
import {
  InstanceChallengeNotAvailableError,
  InstanceQuotaExceededError,
  InstanceRenewalTooEarlyError,
} from '../../domains/instances/repository'
import { createDatabaseClient, type DatabaseClient } from './client'
import { PostgresInstanceRepository } from './instance-repository'
import { runMigrations } from './migrate'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`
const at = new Date('2026-09-01T08:00:00.000Z')
const leasePolicy = {
  initialDurationMs: 60 * 60_000,
  extensionDurationMs: 30 * 60_000,
  renewalWindowMs: 10 * 60_000,
  teamActiveLimit: 1,
}

function quotedDatabaseName(): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected test database name')
  return `"${databaseName}"`
}

describeWithPostgres('PostgreSQL instance control plane', () => {
  let admin: Client
  let database: DatabaseClient
  let repository: PostgresInstanceRepository

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 8 })
    await runMigrations(database)
    repository = new PostgresInstanceRepository(database.pool)
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

  async function fixture(options: {
    participationStatus?: 'pending' | 'accepted'
    startAt?: Date
    endAt?: Date
    practiceEnabled?: boolean
    enabled?: boolean
    publishAt?: Date | null
    closeAt?: Date | null
  } = {}) {
    const suffix = randomUUID()
    const user = await database.pool.query<{ id: string }>(`
      INSERT INTO users
        (username, username_normalized, email, email_normalized, email_verified_at)
      VALUES ($1, $2, $3, $3, $4)
      RETURNING id`, [`Player-${suffix}`, `player-${suffix}`, `player-${suffix}@example.test`, at])
    const userId = user.rows[0]!.id
    const connection = await database.pool.connect()
    let teamId: string
    try {
      await connection.query('BEGIN')
      const team = await connection.query<{ id: string }>(`
        INSERT INTO teams (name, name_normalized, created_by)
        VALUES ($1, $2, $3)
        RETURNING id`, [`Team-${suffix}`, `team-${suffix}`, userId])
      teamId = team.rows[0]!.id
      await connection.query(`
        INSERT INTO team_members (team_id, user_id, role)
        VALUES ($1, $2, 'captain')`, [teamId, userId])
      await connection.query('COMMIT')
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
    const contest = await database.pool.query<{ id: string }>(`
      INSERT INTO contests
        (title, slug, start_at, end_at, practice_enabled, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id`, [
      `Contest-${suffix}`,
      `contest-${suffix}`,
      options.startAt ?? new Date(at.getTime() - 60_000),
      options.endAt ?? new Date(at.getTime() + 2 * 60 * 60_000),
      options.practiceEnabled ?? false,
      userId,
    ])
    const contestId = contest.rows[0]!.id
    const participationStatus = options.participationStatus ?? 'accepted'
    const participation = await database.pool.query<{ id: string }>(`
      INSERT INTO participations
        (contest_id, team_id, status, registered_by, reviewed_by, reviewed_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id`, [
      contestId,
      teamId,
      participationStatus,
      userId,
      participationStatus === 'accepted' ? userId : null,
      participationStatus === 'accepted' ? at : null,
    ])
    const challenge = await createPublishableChallenge(database.pool, contestId, userId, {
      enabled: options.enabled,
      publishAt: options.publishAt,
      closeAt: options.closeAt,
      instancePolicy: {
        type: 'dynamic',
        provider: 'docker',
        image: 'nginx:alpine',
        entry_port: 80,
        entry_protocol: 'http',
      },
    })
    const secondChallenge = await createPublishableChallenge(database.pool, contestId, userId, {
      instancePolicy: {
        type: 'dynamic',
        provider: 'docker',
        image: 'nginx:alpine',
        entry_port: 80,
        entry_protocol: 'http',
      },
    })
    await database.pool.query(`
      UPDATE contests
      SET publication_status = 'published', published_at = $2, updated_at = $2
      WHERE id = $1`, [contestId, new Date(at.getTime() - 120_000)])
    return {
      userId,
      teamId,
      contestId,
      participationId: participation.rows[0]!.id,
      challengeId: challenge.challengeId,
      secondChallengeId: secondChallenge.challengeId,
    }
  }

  function command(input: Awaited<ReturnType<typeof fixture>>, requestId: string = randomUUID(), commandAt = at) {
    return {
      actorId: input.userId,
      requestId,
      contestId: input.contestId,
      challengeId: input.challengeId,
      at: commandAt,
      policy: leasePolicy,
    }
  }

  it('serializes duplicate starts into one desired generation, task, and audit event', async () => {
    const input = await fixture()
    const [first, second] = await Promise.all([
      repository.start(command(input)),
      repository.start(command(input)),
    ])
    expect(first.id).toBe(second.id)
    expect(first.desiredGeneration).toBe(1)
    expect(second.desiredGeneration).toBe(1)
    const facts = await database.pool.query<{
      instances: string
      jobs: string
      audits: string
      payload: Record<string, unknown>
    }>(`
      SELECT
        (SELECT count(*)::text FROM instances WHERE participation_id = $1) AS instances,
        (SELECT count(*)::text FROM instance_jobs job JOIN instances instance ON instance.id = job.instance_id WHERE instance.participation_id = $1) AS jobs,
        (SELECT count(*)::text FROM audit_events WHERE target_type = 'instance' AND action = 'instance.started' AND metadata->>'contest_id' = $2) AS audits,
        (SELECT payload FROM instance_jobs job JOIN instances instance ON instance.id = job.instance_id WHERE instance.participation_id = $1 LIMIT 1) AS payload`,
    [input.participationId, input.contestId])
    expect(facts.rows[0]).toMatchObject({ instances: '1', jobs: '1', audits: '1' })
    expect(facts.rows[0]!.payload).toMatchObject({
      schema: 'instance-job.v1',
      provider: 'docker',
      target: {
        contest_id: input.contestId,
        contest_challenge_id: input.challengeId,
        participation_id: input.participationId,
        team_id: input.teamId,
      },
      spec: { image: 'nginx:alpine', secret_envelope: null },
    })
  })

  it('enforces the team quota under the participation lock', async () => {
    const input = await fixture()
    await repository.start(command(input))
    await expect(repository.start(command({ ...input, challengeId: input.secondChallengeId })))
      .rejects.toBeInstanceOf(InstanceQuotaExceededError)
    const count = await database.pool.query<{ count: string }>(`
      SELECT count(*)::text FROM instances WHERE participation_id = $1`, [input.participationId])
    expect(count.rows[0]!.count).toBe('1')
  })

  it('rejects early renewal, then atomically extends and destroys through new generations', async () => {
    const input = await fixture()
    const started = await repository.start(command(input))
    await expect(repository.renew(command(input, randomUUID(), new Date(at.getTime() + 5 * 60_000))))
      .rejects.toBeInstanceOf(InstanceRenewalTooEarlyError)

    const renewAt = new Date(started.expiresAt!.getTime() - 5 * 60_000)
    const renewed = await repository.renew(command(input, randomUUID(), renewAt))
    expect(renewed.desiredGeneration).toBe(2)
    expect(renewed.expiresAt?.toISOString()).toBe(
      new Date(started.expiresAt!.getTime() + leasePolicy.extensionDurationMs).toISOString(),
    )
    const destroyed = await repository.destroy(command(input))
    expect(destroyed).toMatchObject({ desiredState: 'stopped', desiredGeneration: 3 })
    await repository.destroy(command(input))

    const facts = await database.pool.query<{ jobs: string, audits: string }>(`
      SELECT
        (SELECT count(*)::text FROM instance_jobs WHERE instance_id = $1) AS jobs,
        (SELECT count(*)::text FROM audit_events WHERE target_type = 'instance' AND target_id = $1) AS audits`,
    [started.id])
    expect(facts.rows[0]).toEqual({ jobs: '3', audits: '3' })
  })

  it('applies phase and challenge release rules before creating any instance fact', async () => {
    const upcoming = await fixture({ startAt: new Date(at.getTime() + 60_000) })
    await expect(repository.start(command(upcoming))).rejects.toBeTruthy()
    const closed = await fixture({ closeAt: new Date(at.getTime() - 1) })
    await expect(repository.start(command(closed))).rejects.toBeInstanceOf(InstanceChallengeNotAvailableError)
    const count = await database.pool.query<{ count: string }>(`
      SELECT count(*)::text FROM instances WHERE participation_id IN ($1, $2)`,
    [upcoming.participationId, closed.participationId])
    expect(count.rows[0]!.count).toBe('0')
  })

  it('rolls back instance and job facts when the audit insert fails', async () => {
    const input = await fixture()
    await expect(repository.start(command(input, ''))).rejects.toMatchObject({ code: '23514' })
    const facts = await database.pool.query<{ instances: string, jobs: string, audits: string }>(`
      SELECT
        (SELECT count(*)::text FROM instances WHERE participation_id = $1) AS instances,
        (SELECT count(*)::text FROM instance_jobs job JOIN instances instance ON instance.id = job.instance_id WHERE instance.participation_id = $1) AS jobs,
        (SELECT count(*)::text FROM audit_events WHERE metadata->>'contest_id' = $2) AS audits`,
    [input.participationId, input.contestId])
    expect(facts.rows[0]).toEqual({ instances: '0', jobs: '0', audits: '0' })
  })
})
