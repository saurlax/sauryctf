import { randomBytes, randomUUID } from 'node:crypto'
import { PostgresTestClient as Client } from '../../test-support/postgres-database'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { reconcileInstanceJobPayloadSchema } from '../../../shared/contracts/instance-jobs'
import type { OperationalCommandRecordInput } from '../../domains/administration/operations'
import { createPublishableChallenge } from '../../test-support/publishable-challenge'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { runPostgresTestMigrations } from '../../test-support/postgres-database'
import { PostgresOperationalCommandRepository } from './operations-repository'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`
const now = new Date('2026-09-02T00:00:00.000Z')

function quotedDatabaseName(): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected test database name')
  return `"${databaseName}"`
}

describeWithPostgres('PostgreSQL operational command repository', () => {
  let admin: Client
  let database: PostgresTestDatabase
  let repository: PostgresOperationalCommandRepository
  let actorId: string
  let targetUserId: string
  let contestId: string
  let participationId: string
  let challengeId: string
  let teamId: string
  let instanceId: string
  let deadJobId: string

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createPostgresTestDatabase({ connectionString: url.toString(), maxConnections: 4 })
    await runPostgresTestMigrations(database)
    repository = new PostgresOperationalCommandRepository(database.executor)

    const suffix = randomUUID()
    const actors = await database.executor.query<{ id: string }>(`
      INSERT INTO users
        (username, username_normalized, email, email_normalized, email_verified_at)
      VALUES
        ($1, $2, $3, $3, $7),
        ($4, $5, $6, $6, $7)
      RETURNING id`, [
      `Operations-${suffix}`, `operations-${suffix}`, `operations-${suffix}@example.test`,
      `Target-${suffix}`, `target-${suffix}`, `target-${suffix}@example.test`, now,
    ])
    actorId = actors.rows[0]!.id
    targetUserId = actors.rows[1]!.id

    const connection = await database.connect()
    try {
      await connection.query('BEGIN')
      const team = await connection.query<{ id: string }>(`
        INSERT INTO teams (name, name_normalized, created_by)
        VALUES ($1, $2, $3)
        RETURNING id`, [`Operations Team ${suffix}`, `operations-team-${suffix}`, actorId])
      teamId = team.rows[0]!.id
      await connection.query(`
        INSERT INTO team_members (team_id, user_id, role)
        VALUES ($1, $2, 'captain')`, [teamId, actorId])
      await connection.query('COMMIT')
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }

    const contest = await database.executor.query<{ id: string }>(`
      INSERT INTO contests
        (title, slug, visibility, start_at, end_at, created_by)
      VALUES ($1, $2, 'public', $3, $4, $5)
      RETURNING id`, [
      `Operations Contest ${suffix}`,
      `operations-contest-${suffix}`,
      new Date(now.getTime() - 60_000),
      new Date(now.getTime() + 60_000),
      actorId,
    ])
    contestId = contest.rows[0]!.id
    const participation = await database.executor.query<{ id: string }>(`
      INSERT INTO participations
        (contest_id, team_id, status, registered_by, reviewed_by, reviewed_at)
      VALUES ($1, $2, 'accepted', $3, $3, $4)
      RETURNING id`, [contestId, teamId, actorId, now])
    participationId = participation.rows[0]!.id
    challengeId = (await createPublishableChallenge(database.executor, contestId, actorId, {
      instancePolicy: {
        type: 'dynamic',
        provider: 'docker',
        image: 'nginx:alpine',
        entry_port: 80,
        entry_protocol: 'http',
      },
    })).challengeId

    const instance = await database.executor.query<{ id: string }>(`
      INSERT INTO instances
        (contest_id, contest_challenge_id, participation_id, provider,
         desired_state, desired_generation, observed_state, expires_at, updated_at)
      VALUES ($1, $2, $3, 'docker', 'running', 1, 'failed', $4, $5)
      RETURNING id`, [contestId, challengeId, participationId, new Date(now.getTime() + 3_600_000), now])
    instanceId = instance.rows[0]!.id
    const runtimeSpec = {
      image: 'nginx:alpine',
      entrypoints: [{ name: 'http', protocol: 'http', container_port: 80 }],
      environment: [],
      resources: {
        cpu_millicores: 100,
        memory_bytes: 64 * 1024 * 1024,
        ephemeral_storage_bytes: 64 * 1024 * 1024,
      },
      network: { egress: 'deny' },
      secret_envelope: null,
    }
    const deadJob = await database.executor.query<{ id: string }>(`
      INSERT INTO instance_jobs
        (instance_id, operation, payload_version, payload, desired_generation,
         idempotency_key, status, attempt_count, max_attempts,
         error_code, error_summary, finished_at)
      VALUES ($1, 'ensure', 1, $2, 1, $3, 'dead', 1, 1,
              'provider.image_missing', 'image unavailable', $4)
      RETURNING id`, [
      instanceId,
      {
        schema: 'instance-job.v1',
        provider: 'docker',
        target: {
          contest_id: contestId,
          contest_challenge_id: challengeId,
          participation_id: participationId,
          team_id: teamId,
        },
        expires_at: new Date(now.getTime() + 3_600_000).toISOString(),
        spec: runtimeSpec,
      },
      `operations-ensure-${suffix}`,
      now,
    ])
    deadJobId = deadJob.rows[0]!.id
    await database.executor.query(`
      INSERT INTO instance_job_attempts
        (job_id, attempt_number, worker_id, fencing_token, outcome,
         error_code, error_summary, started_at, finished_at)
      VALUES ($1, 1, 'worker-1', 1, 'permanent_error',
              'provider.image_missing', 'image unavailable', $2, $2)`, [deadJobId, now])

    const submission = await database.executor.query<{ id: string }>(`
      INSERT INTO submissions
        (contest_id, contest_challenge_id, participation_id, user_id, mode,
         result, answer_digest, answer_ciphertext, request_id, submitted_at)
      VALUES ($1, $2, $3, $4, 'official', 'correct', $5, $6, $7, $8)
      RETURNING id`, [
      contestId, challengeId, participationId, actorId,
      randomBytes(32), randomBytes(33), `operations-submission-${suffix}`, now,
    ])
    await database.executor.query(`
      INSERT INTO solves
        (submission_id, contest_id, contest_challenge_id, participation_id,
         mode, awarded_score, solve_order, solved_at)
      VALUES ($1, $2, $3, $4, 'official', 500, 1, $5)`, [
      submission.rows[0]!.id, contestId, challengeId, participationId, now,
    ])
    await database.executor.query(`
      INSERT INTO score_adjustments
        (contest_id, participation_id, points_delta, reason, created_by, request_id, created_at)
      VALUES ($1, $2, 25, 'Manual ruling', $3, $4, $5)`, [
      contestId, participationId, actorId, `operations-adjustment-${suffix}`, now,
    ])
    await database.executor.query(`
      INSERT INTO scoreboard_versions (contest_id, version, updated_at)
      VALUES ($1, 2, $2)`, [contestId, now])
    await database.executor.query(`
      INSERT INTO scoreboard_snapshots (contest_id, view, scope_key, version, payload, built_at)
      VALUES ($1, 'public', 'overall', 2, $2, $3)`, [
      contestId,
      { schema: 'scoreboard.v1', scope: { type: 'overall' }, scopeKey: 'overall', challenges: [], rows: [] },
      now,
    ])
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

  function command(
    kind: OperationalCommandRecordInput['kind'],
    targetId: string,
    suffix: string,
  ): OperationalCommandRecordInput {
    return {
      kind,
      targetId,
      actorId,
      requestId: `operations-request-${suffix}`,
      idempotencyKey: `operations-command-${suffix}`,
      reason: `Verified recovery reason ${suffix}`,
      at: now,
    }
  }

  async function expectSingleAudit(action: string) {
    const audits = await database.executor.query<{ count: string }>(`
      SELECT count(*)::text FROM audit_events WHERE action = $1`, [action])
    expect(audits.rows[0]!.count).toBe('1')
  }

  it('invalidates a user session version exactly once for an idempotent command', async () => {
    const input = command('session_invalidate', targetUserId, 'session-0001')
    const first = await repository.executeDatabase(input)
    const replayed = await repository.executeDatabase(input)
    const user = await database.executor.query<{ session_version: string }>(`
      SELECT session_version::text FROM users WHERE id = $1`, [targetUserId])

    expect(first).toMatchObject({ kind: 'session_invalidate', replayed: false })
    expect(replayed).toMatchObject({ id: first.id, replayed: true })
    expect(user.rows[0]!.session_version).toBe('2')
    await expectSingleAudit('operations.session_invalidate')

    await expect(repository.executeDatabase({
      ...input,
      kind: 'instance_reconcile',
      targetId: instanceId,
    })).rejects.toMatchObject({ code: 'operations.idempotency_conflict' })
  })

  it('replays only the current-generation dead task while preserving attempt evidence', async () => {
    const result = await repository.executeDatabase(command('dead_letter_replay', deadJobId, 'dead-0001'))
    const job = await database.executor.query<{
      status: string
      attempt_count: number
      max_attempts: number
      error_code: string | null
    }>(`
      SELECT status::text, attempt_count, max_attempts, error_code
      FROM instance_jobs WHERE id = $1`, [deadJobId])
    const attempts = await database.executor.query<{ count: string }>(`
      SELECT count(*)::text FROM instance_job_attempts WHERE job_id = $1`, [deadJobId])

    expect(result.result).toMatchObject({ job_id: deadJobId, next_attempt: 2, max_attempts: 2 })
    expect(job.rows[0]).toEqual({ status: 'ready', attempt_count: 1, max_attempts: 2, error_code: null })
    expect(attempts.rows[0]!.count).toBe('1')
    await expectSingleAudit('operations.dead_letter_replay')

    const noncurrent = await database.executor.query<{ id: string }>(`
      INSERT INTO instance_jobs
        (instance_id, operation, payload_version, payload, desired_generation,
         idempotency_key, status, attempt_count, max_attempts, error_code, finished_at)
      VALUES ($1, 'inspect', 1, $2, 2, $3, 'dead', 1, 1, 'provider.timeout', $4)
      RETURNING id`, [
      instanceId,
      {
        schema: 'instance-job.v1',
        provider: 'docker',
        target: {
          contest_id: contestId,
          contest_challenge_id: challengeId,
          participation_id: participationId,
          team_id: teamId,
        },
        expires_at: null,
      },
      `operations-noncurrent-${randomUUID()}`,
      now,
    ])
    await expect(repository.executeDatabase(command(
      'dead_letter_replay',
      noncurrent.rows[0]!.id,
      'dead-noncurrent-0001',
    ))).rejects.toMatchObject({ code: 'operations.target_state_invalid' })
  })

  it('creates one valid reconcile job for the current desired generation', async () => {
    const input = command('instance_reconcile', instanceId, 'reconcile-0001')
    const first = await repository.executeDatabase(input)
    const replayed = await repository.executeDatabase(input)
    const jobs = await database.executor.query<{ payload: unknown, desired_generation: string }>(`
      SELECT payload, desired_generation::text
      FROM instance_jobs
      WHERE instance_id = $1 AND operation = 'reconcile'`, [instanceId])

    expect(first.result).toMatchObject({ instance_id: instanceId, desired_generation: 1, next_attempt: 1 })
    expect(replayed).toMatchObject({ id: first.id, replayed: true })
    expect(jobs.rows).toHaveLength(1)
    expect(jobs.rows[0]!.desired_generation).toBe('1')
    expect(reconcileInstanceJobPayloadSchema.parse(jobs.rows[0]!.payload)).toMatchObject({
      desired_state: 'running',
      target: { contest_id: contestId, contest_challenge_id: challengeId, team_id: teamId },
    })
    await expectSingleAudit('operations.instance_reconcile')
  })

  it('removes only derived snapshots during result recalculation and retains official facts', async () => {
    const before = await database.executor.query<{ submissions: string, solves: string, adjustments: string }>(`
      SELECT
        (SELECT count(*)::text FROM submissions WHERE contest_id = $1) AS submissions,
        (SELECT count(*)::text FROM solves WHERE contest_id = $1) AS solves,
        (SELECT count(*)::text FROM score_adjustments WHERE contest_id = $1) AS adjustments`, [contestId])
    const input = command('result_recalculate', contestId, 'results-0001')
    const reservation = await repository.reserveExternal(input)
    const removed = await repository.clearScoreboardSnapshots(contestId)
    await repository.completeExternal(reservation.commandId, {
      contest_id: contestId,
      snapshots_cleared: removed,
      projections_rebuilt: 2,
    }, now)
    const after = await database.executor.query<{ submissions: string, solves: string, adjustments: string, snapshots: string }>(`
      SELECT
        (SELECT count(*)::text FROM submissions WHERE contest_id = $1) AS submissions,
        (SELECT count(*)::text FROM solves WHERE contest_id = $1) AS solves,
        (SELECT count(*)::text FROM score_adjustments WHERE contest_id = $1) AS adjustments,
        (SELECT count(*)::text FROM scoreboard_snapshots WHERE contest_id = $1) AS snapshots`, [contestId])

    expect(removed).toBe(1)
    expect(after.rows[0]).toMatchObject({ ...before.rows[0], snapshots: '0' })
    await expectSingleAudit('operations.result_recalculate')
  })
})
