import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabaseClient, type DatabaseClient } from './client'
import { runMigrations } from './migrate'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName(): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected test database name')
  return `"${databaseName}"`
}

describeWithPostgres('submission and scoring authority schema', () => {
  let admin: Client
  let database: DatabaseClient
  let userId: string
  let contestId: string
  let challengeId: string
  let participationId: string

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 8 })
    await runMigrations(database)

    const user = await database.pool.query<{ id: string }>(
      `INSERT INTO users (username, username_normalized, email, email_normalized, email_verified_at)
       VALUES ('ScoringUser', 'scoringuser', 'scoring@example.test', 'scoring@example.test', now()) RETURNING id`,
    )
    userId = user.rows[0]!.id
    const connection = await database.pool.connect()
    try {
      await connection.query('BEGIN')
      const team = await connection.query<{ id: string }>(
        `INSERT INTO teams (name, name_normalized, created_by)
         VALUES ('Scoring Team', 'scoring team', $1) RETURNING id`,
        [userId],
      )
      await connection.query(
        `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'captain')`,
        [team.rows[0]!.id, userId],
      )
      await connection.query('COMMIT')

      const contest = await database.pool.query<{ id: string }>(
        `INSERT INTO contests (title, slug, start_at, end_at, created_by)
         VALUES ('Scoring Contest', $1, now() - interval '1 hour', now() + interval '1 hour', $2) RETURNING id`,
        [`scoring-${randomUUID()}`, userId],
      )
      contestId = contest.rows[0]!.id
      const participation = await database.pool.query<{ id: string }>(
        `INSERT INTO participations
           (contest_id, team_id, status, registered_by, reviewed_by, reviewed_at)
         VALUES ($1, $2, 'accepted', $3, $3, now()) RETURNING id`,
        [contestId, team.rows[0]!.id, userId],
      )
      participationId = participation.rows[0]!.id
      const template = await database.pool.query<{ id: string }>(
        `INSERT INTO challenge_templates (name, slug, created_by)
         VALUES ('Scoring Template', $1, $2) RETURNING id`,
        [`scoring-template-${randomUUID()}`, userId],
      )
      const version = await database.pool.query<{ id: string }>(
        `INSERT INTO challenge_template_versions
           (template_id, version_number, title, category, description, flag_policy, scoring_policy, created_by)
         VALUES ($1, 1, 'Score Me', 'misc', 'Statement', '{}', '{"type":"fixed-v1","points":500}', $2)
         RETURNING id`,
        [template.rows[0]!.id, userId],
      )
      const challenge = await database.pool.query<{ id: string }>(
        `INSERT INTO contest_challenges
           (contest_id, source_template_id, source_version_id, title, category, description, flag_policy, scoring_policy)
         VALUES ($1, $2, $3, 'Score Me', 'misc', 'Statement', '{}', '{"type":"fixed-v1","points":500}')
         RETURNING id`,
        [contestId, template.rows[0]!.id, version.rows[0]!.id],
      )
      challengeId = challenge.rows[0]!.id
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
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

  async function createSubmission(mode: 'official' | 'practice'): Promise<string> {
    const submission = await database.pool.query<{ id: string }>(
      `INSERT INTO submissions
         (contest_id, contest_challenge_id, participation_id, user_id, mode, result, answer_digest, request_id)
       VALUES ($1, $2, $3, $4, $5, 'correct', $6, $7) RETURNING id`,
      [contestId, challengeId, participationId, userId, mode, Buffer.from(randomUUID()), randomUUID()],
    )
    return submission.rows[0]!.id
  }

  it('allows one solve per participation, challenge, and mode under concurrency', async () => {
    const [submissionA, submissionB] = await Promise.all([
      createSubmission('official'),
      createSubmission('official'),
    ])
    const insertSolve = (submissionId: string) => database.pool.query(
      `INSERT INTO solves
         (submission_id, contest_id, contest_challenge_id, participation_id, mode, awarded_score, solve_order, solved_at)
       VALUES ($1, $2, $3, $4, 'official', 500, 1, now())`,
      [submissionId, contestId, challengeId, participationId],
    )
    const outcomes = await Promise.allSettled([insertSolve(submissionA), insertSolve(submissionB)])
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1)

    const practiceSubmission = await createSubmission('practice')
    await database.pool.query(
      `INSERT INTO solves
         (submission_id, contest_id, contest_challenge_id, participation_id, mode, awarded_score, solve_order, solved_at)
       VALUES ($1, $2, $3, $4, 'practice', 500, 1, now())`,
      [practiceSubmission, contestId, challengeId, participationId],
    )
    const solves = await database.pool.query<{ mode: string }>(
      `SELECT mode::text FROM solves WHERE participation_id = $1 ORDER BY mode`,
      [participationId],
    )
    expect(solves.rows).toEqual([{ mode: 'official' }, { mode: 'practice' }])
  })

  it('keeps submission, solve, and score adjustment facts append-only', async () => {
    const submissionId = await createSubmission('practice')
    await expect(database.pool.query(
      `UPDATE submissions SET result = 'incorrect' WHERE id = $1`,
      [submissionId],
    )).rejects.toMatchObject({ code: '55000' })

    const adjustment = await database.pool.query<{ id: string }>(
      `INSERT INTO score_adjustments
         (contest_id, participation_id, points_delta, reason, created_by, request_id)
       VALUES ($1, $2, 25, 'Manual ruling', $3, $4) RETURNING id`,
      [contestId, participationId, userId, randomUUID()],
    )
    await expect(database.pool.query(
      'DELETE FROM score_adjustments WHERE id = $1',
      [adjustment.rows[0]!.id],
    )).rejects.toMatchObject({ code: '55000' })
  })

  it('versions overall scoreboard snapshots without nullable uniqueness gaps', async () => {
    await database.pool.query(
      `INSERT INTO scoreboard_versions (contest_id, version) VALUES ($1, 1)`,
      [contestId],
    )
    await database.pool.query(
      `INSERT INTO scoreboard_snapshots (contest_id, view, scope_key, version, payload)
       VALUES ($1, 'public', 'overall', 1, '{"rows":[]}')`,
      [contestId],
    )
    await expect(database.pool.query(
      `INSERT INTO scoreboard_snapshots (contest_id, view, scope_key, version, payload)
       VALUES ($1, 'public', 'overall', 1, '{"rows":[]}')`,
      [contestId],
    )).rejects.toMatchObject({ code: '23505' })
  })
})
