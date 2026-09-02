import { randomBytes, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DataRetentionService } from '../../jobs/data-retention'
import { createPublishableChallenge } from '../../test-support/publishable-challenge'
import { createDatabaseClient, type DatabaseClient } from './client'
import {
  PostgresDataRetentionRepository,
  PostgresSecurityLogWriter,
} from './data-retention-repository'
import { runMigrations } from './migrate'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`
const dayMs = 24 * 60 * 60 * 1000

function quotedDatabaseName(): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected test database name')
  return `"${databaseName}"`
}

describeWithPostgres('PostgreSQL data retention', () => {
  let admin: Client
  let database: DatabaseClient
  let repository: PostgresDataRetentionRepository
  let securityLogs: PostgresSecurityLogWriter
  let now: Date
  let actorId: string
  let contestId: string
  let expiredAuditId: string
  let retainedAuditId: string
  let expiredSecurityId: string
  let retainedSecurityId: string

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 4 })
    await runMigrations(database)
    repository = new PostgresDataRetentionRepository(database.pool)
    securityLogs = new PostgresSecurityLogWriter(database.pool)
    now = new Date(Date.now() - 2_000)

    const suffix = randomUUID()
    const actor = await database.pool.query<{ id: string }>(`
      INSERT INTO users
        (username, username_normalized, email, email_normalized, email_verified_at)
      VALUES ($1, $2, $3, $3, $4)
      RETURNING id`, [`Retention-${suffix}`, `retention-${suffix}`, `retention-${suffix}@example.test`, now])
    actorId = actor.rows[0]!.id

    const connection = await database.pool.connect()
    let teamId: string
    try {
      await connection.query('BEGIN')
      const team = await connection.query<{ id: string }>(`
        INSERT INTO teams (name, name_normalized, created_by)
        VALUES ($1, $2, $3)
        RETURNING id`, [`Retention Team ${suffix}`, `retention-team-${suffix}`, actorId])
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

    const contest = await database.pool.query<{ id: string }>(`
      INSERT INTO contests (title, slug, start_at, end_at, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id`, [
      `Retention Contest ${suffix}`,
      `retention-contest-${suffix}`,
      new Date(now.getTime() - 500 * dayMs),
      new Date(now.getTime() - 499 * dayMs),
      actorId,
    ])
    contestId = contest.rows[0]!.id
    const participation = await database.pool.query<{ id: string }>(`
      INSERT INTO participations
        (contest_id, team_id, status, registered_by, reviewed_by, reviewed_at)
      VALUES ($1, $2, 'accepted', $3, $3, $4)
      RETURNING id`, [contestId, teamId, actorId, new Date(now.getTime() - 500 * dayMs)])
    const participationId = participation.rows[0]!.id
    const challengeId = (await createPublishableChallenge(database.pool, contestId, actorId)).challengeId
    const factAt = new Date(now.getTime() - 499 * dayMs)
    const submission = await database.pool.query<{ id: string }>(`
      INSERT INTO submissions
        (contest_id, contest_challenge_id, participation_id, user_id, mode,
         result, answer_digest, answer_ciphertext, request_id, submitted_at)
      VALUES ($1, $2, $3, $4, 'official', 'correct', $5, $6, $7, $8)
      RETURNING id`, [
      contestId, challengeId, participationId, actorId,
      randomBytes(32), randomBytes(33), `retention-submission-${suffix}`, factAt,
    ])
    await database.pool.query(`
      INSERT INTO solves
        (submission_id, contest_id, contest_challenge_id, participation_id,
         mode, awarded_score, solve_order, solved_at)
      VALUES ($1, $2, $3, $4, 'official', 500, 1, $5)`, [
      submission.rows[0]!.id, contestId, challengeId, participationId, factAt,
    ])
    await database.pool.query(`
      INSERT INTO score_adjustments
        (contest_id, participation_id, points_delta, reason, created_by, request_id, created_at)
      VALUES ($1, $2, 25, 'Historical ruling', $3, $4, $5)`, [
      contestId, participationId, actorId, `retention-adjustment-${suffix}`, factAt,
    ])
    await database.pool.query(`
      INSERT INTO scoreboard_versions (contest_id, version, updated_at)
      VALUES ($1, 2, $2)`, [contestId, factAt])

    const audits = await database.pool.query<{ id: string }>(`
      INSERT INTO audit_events
        (actor_user_id, action, target_type, target_id, reason, outcome,
         request_id, changes, metadata, occurred_at)
      VALUES
        ($1, 'retention.expired', 'contest', $2, 'expired audit fixture', 'succeeded', $3, '{}', '{}', $5),
        ($1, 'retention.retained', 'contest', $2, 'retained audit fixture', 'succeeded', $4, '{}', '{}', $6)
      RETURNING id`, [
      actorId,
      contestId,
      `retention-audit-expired-${suffix}`,
      `retention-audit-retained-${suffix}`,
      new Date(now.getTime() - 366 * dayMs),
      new Date(now.getTime() - 364 * dayMs),
    ])
    expiredAuditId = audits.rows[0]!.id
    retainedAuditId = audits.rows[1]!.id

    await securityLogs.record({
      eventType: 'request.rejected',
      severity: 'warn',
      requestId: `retention-security-expired-${suffix}`,
      errorCode: 'security.csrf_invalid',
      method: 'POST',
      route: '/api/teams',
      statusCode: 403,
      occurredAt: new Date(now.getTime() - 91 * dayMs),
    })
    await securityLogs.record({
      eventType: 'request.rejected',
      severity: 'warn',
      requestId: `retention-security-retained-${suffix}`,
      errorCode: 'identity.invalid_credentials',
      method: 'POST',
      route: '/api/auth/login',
      statusCode: 401,
      occurredAt: new Date(now.getTime() - 89 * dayMs),
    })
    const storedSecurity = await database.pool.query<{ id: string }>(`
      SELECT id::text FROM security_log_events ORDER BY occurred_at, id`)
    expiredSecurityId = storedSecurity.rows[0]!.id
    retainedSecurityId = storedSecurity.rows[1]!.id
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

  it('keeps audit and security logs append-only outside the bounded retention function', async () => {
    await expect(database.pool.query('DELETE FROM audit_events WHERE id = $1', [retainedAuditId]))
      .rejects.toMatchObject({ code: '55000' })
    await expect(database.pool.query('UPDATE security_log_events SET route = $2 WHERE id = $1', [
      retainedSecurityId,
      '/rewritten',
    ])).rejects.toMatchObject({ code: '55000' })
  })

  it('purges expired operational evidence without deleting authoritative contest facts', async () => {
    const before = await factCounts()
    const result = await new DataRetentionService(repository, () => now).run(100, 2)
    const after = await factCounts()
    const evidence = await database.pool.query<{ id: string }>(`
      SELECT id::text FROM audit_events
      WHERE id = ANY($1::uuid[])
      UNION ALL
      SELECT id::text FROM security_log_events
      WHERE id = ANY($2::uuid[])
      ORDER BY id`, [[expiredAuditId, retainedAuditId], [expiredSecurityId, retainedSecurityId]])

    expect(result).toMatchObject({
      auditDeleted: 1,
      securityLogsDeleted: 1,
      officialContestFacts: 'indefinite',
    })
    expect(after).toEqual(before)
    expect(evidence.rows.map(row => row.id).sort()).toEqual([retainedAuditId, retainedSecurityId].sort())
  })

  it('rejects a retention caller that attempts to shorten the minimum windows', async () => {
    await expect(repository.purgeExpired({
      auditBefore: now,
      securityBefore: now,
      limit: 100,
    })).rejects.toMatchObject({ code: '22023' })
  })

  async function factCounts() {
    const result = await database.pool.query<{
      submissions: string
      solves: string
      adjustments: string
      versions: string
    }>(`
      SELECT
        (SELECT count(*)::text FROM submissions WHERE contest_id = $1) AS submissions,
        (SELECT count(*)::text FROM solves WHERE contest_id = $1) AS solves,
        (SELECT count(*)::text FROM score_adjustments WHERE contest_id = $1) AS adjustments,
        (SELECT count(*)::text FROM scoreboard_versions WHERE contest_id = $1) AS versions`, [contestId])
    return result.rows[0]!
  }
})
