import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { monitoringKindSchema } from '../../../shared/contracts/monitoring'
import { createPublishableChallenge } from '../../test-support/publishable-challenge'
import { createDatabaseClient, type DatabaseClient } from './client'
import { runMigrations } from './migrate'
import { PostgresMonitoringRepository } from './monitoring-repository'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName(): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected test database name')
  return `"${databaseName}"`
}

describe('PostgreSQL administration monitoring projection', () => {
  it('passes bounded filters and marks an active instance with an old Worker observation stale', async () => {
    const query = vi.fn(async () => ({ rows: [{
      kind: 'instances',
      id: '018f47a2-4ef8-7e2c-9c24-000000000301',
      contest_id: '018f47a2-4ef8-7e2c-9c24-000000000302',
      challenge_id: '018f47a2-4ef8-7e2c-9c24-000000000303',
      team_id: '018f47a2-4ef8-7e2c-9c24-000000000304',
      status: 'running',
      fact_at: new Date('2026-09-02T00:00:00.000Z'),
      worker_observed_at: new Date('2026-09-01T23:58:00.000Z'),
      details: { provider: 'docker', last_error_code: null },
    }] }))
    const repository = new PostgresMonitoringRepository({ query } as never)
    const items = await repository.list({
      kind: 'instances',
      contest_id: '018f47a2-4ef8-7e2c-9c24-000000000302',
      challenge_id: '018f47a2-4ef8-7e2c-9c24-000000000303',
      team_id: '018f47a2-4ef8-7e2c-9c24-000000000304',
      status: 'running',
      limit: 20,
    }, new Date('2026-09-02T00:00:00.000Z'), 90_000)

    expect(query).toHaveBeenCalledWith(expect.stringContaining('instance.last_observed_at'), [
      '018f47a2-4ef8-7e2c-9c24-000000000302',
      '018f47a2-4ef8-7e2c-9c24-000000000303',
      '018f47a2-4ef8-7e2c-9c24-000000000304',
      'running',
      20,
    ])
    expect(items[0]).toMatchObject({
      worker_observation_stale: true,
      worker_observed_at: '2026-09-01T23:58:00.000Z',
      details: { provider: 'docker' },
    })
    expect(JSON.stringify(items)).not.toMatch(/payload|answer_ciphertext|secret_envelope|last_error_summary/iu)
  })

  it('does not mark a newly queued instance stale before its first observation threshold', async () => {
    const query = vi.fn(async () => ({ rows: [{
      kind: 'instances',
      id: '018f47a2-4ef8-7e2c-9c24-000000000311',
      contest_id: '018f47a2-4ef8-7e2c-9c24-000000000312',
      challenge_id: '018f47a2-4ef8-7e2c-9c24-000000000313',
      team_id: '018f47a2-4ef8-7e2c-9c24-000000000314',
      status: 'pending',
      fact_at: new Date('2026-09-01T23:59:30.000Z'),
      worker_observed_at: null,
      details: { provider: 'docker', desired_state: 'running' },
    }] }))
    const repository = new PostgresMonitoringRepository({ query } as never)

    const items = await repository.list({ kind: 'instances', limit: 20 }, new Date('2026-09-02T00:00:00.000Z'), 90_000)

    expect(items[0]).toMatchObject({
      status: 'pending',
      worker_observed_at: null,
      worker_observation_stale: false,
    })
  })
})

describeWithPostgres('PostgreSQL administration monitoring queries', () => {
  let admin: Client
  let database: DatabaseClient
  let repository: PostgresMonitoringRepository
  const now = new Date('2026-09-02T00:00:00.000Z')
  let contestId: string
  let challengeId: string
  let teamId: string
  let instanceId: string
  let jobId: string
  let mailDeliveryId: string
  let auditId: string

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 4 })
    await runMigrations(database)
    repository = new PostgresMonitoringRepository(database.pool)

    const suffix = randomUUID()
    const user = await database.pool.query<{ id: string }>(`
      INSERT INTO users
        (username, username_normalized, email, email_normalized, email_verified_at)
      VALUES ($1, $2, $3, $3, $4)
      RETURNING id`, [`Monitor-${suffix}`, `monitor-${suffix}`, `monitor-${suffix}@example.test`, now])
    const userId = user.rows[0]!.id
    const connection = await database.pool.connect()
    try {
      await connection.query('BEGIN')
      const team = await connection.query<{ id: string }>(`
        INSERT INTO teams (name, name_normalized, created_by)
        VALUES ($1, $2, $3)
        RETURNING id`, [`Monitor Team ${suffix}`, `monitor-team-${suffix}`, userId])
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
      INSERT INTO contests (title, slug, start_at, end_at, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id`, [
      `Monitor Contest ${suffix}`,
      `monitor-contest-${suffix}`,
      new Date(now.getTime() - 60_000),
      new Date(now.getTime() + 60_000),
      userId,
    ])
    contestId = contest.rows[0]!.id
    const participation = await database.pool.query<{ id: string }>(`
      INSERT INTO participations
        (contest_id, team_id, status, registered_by, reviewed_by, reviewed_at)
      VALUES ($1, $2, 'accepted', $3, $3, $4)
      RETURNING id`, [contestId, teamId, userId, now])
    const participationId = participation.rows[0]!.id
    challengeId = (await createPublishableChallenge(database.pool, contestId, userId, {
      instancePolicy: {
        type: 'dynamic',
        provider: 'docker',
        image: 'nginx:alpine',
        entry_port: 80,
        entry_protocol: 'http',
      },
    })).challengeId

    const instance = await database.pool.query<{ id: string }>(`
      INSERT INTO instances
        (contest_id, contest_challenge_id, participation_id, provider,
         desired_state, observed_state, expires_at, last_observed_at,
         last_error_summary, updated_at)
      VALUES ($1, $2, $3, 'docker', 'running', 'running', $4, $5, $6, $4)
      RETURNING id`, [
      contestId,
      challengeId,
      participationId,
      now,
      new Date(now.getTime() - 120_000),
      'provider secret must stay private',
    ])
    instanceId = instance.rows[0]!.id
    const job = await database.pool.query<{ id: string }>(`
      INSERT INTO instance_jobs
        (instance_id, operation, payload_version, payload, desired_generation,
         idempotency_key, status, error_code, error_summary, finished_at)
      VALUES ($1, 'ensure', 1, $2, 1, $3, 'dead', 'provider.invalid', $4, $5)
      RETURNING id`, [
      instanceId,
      { secret_envelope: 'never expose', answer_ciphertext: 'never expose' },
      `monitor-job-${suffix}`,
      'registry credential must stay private',
      now,
    ])
    jobId = job.rows[0]!.id

    const event = await database.pool.query<{ id: string }>(`
      INSERT INTO domain_outbox
        (aggregate_type, aggregate_id, event_type, dedupe_key, payload)
      VALUES ('user', $1, 'identity.password_changed', $2, $3)
      RETURNING id`, [userId, `monitor-mail-${suffix}`, { reset_token: 'never expose' }])
    await database.pool.query(`
      INSERT INTO notifications (user_id, source_event_id, template_key, payload)
      VALUES ($1, $2, 'identity.password_changed', $3)`, [
      userId,
      event.rows[0]!.id,
      { reset_token: 'never expose' },
    ])
    const delivery = await database.pool.query<{ id: string }>(`
      INSERT INTO mail_deliveries
        (source_event_id, recipient, recipient_normalized, template_key,
         payload, status, attempt_count, last_error, updated_at)
      VALUES ($1, 'operator@example.test', 'operator@example.test',
              'identity.password_changed', $2, 'failed', 1, $3, $4)
      RETURNING id`, [event.rows[0]!.id, { reset_token: 'never expose' }, 'SMTP credential must stay private', now])
    mailDeliveryId = delivery.rows[0]!.id
    const audit = await database.pool.query<{ id: string }>(`
      INSERT INTO audit_events
        (actor_user_id, action, target_type, target_id, reason, outcome,
         request_id, changes, metadata, occurred_at)
      VALUES ($1, 'instance.reconciled', 'instance', $2, 'manual recovery',
              'succeeded', $3, '{}', $4, $5)
      RETURNING id`, [
      userId,
      instanceId,
      `monitor-audit-${suffix}`,
      { contest_id: contestId, challenge_id: challengeId, team_id: teamId },
      now,
    ])
    auditId = audit.rows[0]!.id
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

  it('executes every monitoring projection against the migrated schema', async () => {
    for (const kind of monitoringKindSchema.options) {
      await expect(repository.list({ kind, limit: 10 }, now, 90_000)).resolves.toBeInstanceOf(Array)
    }
  })

  it('filters instance and dead-job facts without exposing sensitive payloads or errors', async () => {
    const instanceItems = await repository.list({
      kind: 'instances', contest_id: contestId, challenge_id: challengeId,
      team_id: teamId, status: 'running', limit: 10,
    }, now, 90_000)
    expect(instanceItems).toEqual([expect.objectContaining({
      id: instanceId,
      worker_observation_stale: true,
      worker_observed_at: new Date(now.getTime() - 120_000).toISOString(),
    })])

    const jobItems = await repository.list({
      kind: 'instance_jobs', contest_id: contestId, challenge_id: challengeId,
      team_id: teamId, status: 'dead', limit: 10,
    }, now, 90_000)
    expect(jobItems).toEqual([expect.objectContaining({ id: jobId, status: 'dead' })])
    expect(JSON.stringify([...instanceItems, ...jobItems])).not.toMatch(
      /secret_envelope|answer_ciphertext|credential|error_summary/iu,
    )
  })

  it('masks mail recipients and never projects delivery payloads or raw errors', async () => {
    const items = await repository.list({ kind: 'mail_deliveries', status: 'failed', limit: 10 }, now, 90_000)
    expect(items).toEqual([expect.objectContaining({
      id: mailDeliveryId,
      status: 'failed',
      details: expect.objectContaining({ recipient: 'o***@example.test', has_error: true }),
    })])
    expect(JSON.stringify(items)).not.toMatch(/reset_token|SMTP credential|last_error/iu)
  })

  it('combines contest, challenge, team and outcome filters for audit metadata', async () => {
    const items = await repository.list({
      kind: 'audit_events', contest_id: contestId, challenge_id: challengeId,
      team_id: teamId, status: 'succeeded', limit: 10,
    }, now, 90_000)
    expect(items).toEqual([expect.objectContaining({
      id: auditId,
      status: 'succeeded',
      details: expect.objectContaining({ action: 'instance.reconciled' }),
    })])
  })
})
