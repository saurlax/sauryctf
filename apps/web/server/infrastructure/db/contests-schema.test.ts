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

describeWithPostgres('Jeopardy contest authority schema', () => {
  let admin: Client
  let database: DatabaseClient
  let organizerId: string
  let teamId: string

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 4 })
    await runMigrations(database)

    const organizer = await database.pool.query<{ id: string }>(
      `INSERT INTO users (username, username_normalized, email, email_normalized)
       VALUES ('ContestOrganizer', 'contestorganizer', 'organizer@example.test', 'organizer@example.test') RETURNING id`,
    )
    organizerId = organizer.rows[0]!.id
    const connection = await database.pool.connect()
    try {
      await connection.query('BEGIN')
      const team = await connection.query<{ id: string }>(
        `INSERT INTO teams (name, name_normalized, created_by)
         VALUES ('Contest Team', 'contest team', $1) RETURNING id`,
        [organizerId],
      )
      teamId = team.rows[0]!.id
      await connection.query(
        `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'captain')`,
        [teamId, organizerId],
      )
      await connection.query('COMMIT')
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

  async function createContest(slug: string): Promise<string> {
    const contest = await database.pool.query<{ id: string }>(
      `INSERT INTO contests (title, slug, start_at, end_at, created_by)
       VALUES ($1, $2, '2030-05-01T08:00:00+08:00', '2030-05-01T20:00:00+08:00', $3)
       RETURNING id`,
      [`Contest ${slug}`, slug, organizerId],
    )
    return contest.rows[0]!.id
  }

  it('enforces publication states and derives phases from UTC instants', async () => {
    const contestId = await createContest(`phase-${randomUUID()}`)
    await expect(database.pool.query(
      `UPDATE contests SET publication_status = 'active' WHERE id = $1`,
      [contestId],
    )).rejects.toMatchObject({ code: '22P02' })
    await expect(database.pool.query(
      `UPDATE contests SET publication_status = 'published' WHERE id = $1`,
      [contestId],
    )).rejects.toMatchObject({ code: '23514' })

    const phases = await database.pool.query<{ upcoming: string, running: string, ended: string }>(
      `SELECT
         derive_contest_time_phase(start_at, end_at, '2030-04-30T23:59:59Z')::text AS upcoming,
         derive_contest_time_phase(start_at, end_at, '2030-05-01T06:00:00Z')::text AS running,
         derive_contest_time_phase(start_at, end_at, '2030-05-01T12:00:00Z')::text AS ended
       FROM contests WHERE id = $1`,
      [contestId],
    )
    expect(phases.rows[0]).toEqual({ upcoming: 'upcoming', running: 'running', ended: 'ended' })

    const timestamps = await database.pool.query<{ start_at: Date, end_at: Date }>(
      'SELECT start_at, end_at FROM contests WHERE id = $1',
      [contestId],
    )
    expect(timestamps.rows[0]!.start_at.toISOString()).toBe('2030-05-01T00:00:00.000Z')
    expect(timestamps.rows[0]!.end_at.toISOString()).toBe('2030-05-01T12:00:00.000Z')
  })

  it('allows one participation per team and contest with a contest-owned division', async () => {
    const contestId = await createContest(`participation-${randomUUID()}`)
    const division = await database.pool.query<{ id: string }>(
      `INSERT INTO divisions (contest_id, name, name_normalized)
       VALUES ($1, 'Open', 'open') RETURNING id`,
      [contestId],
    )
    await database.pool.query(
      `INSERT INTO participations (contest_id, team_id, division_id, status, registered_by)
       VALUES ($1, $2, $3, 'pending', $4)`,
      [contestId, teamId, division.rows[0]!.id, organizerId],
    )
    await expect(database.pool.query(
      `INSERT INTO participations (contest_id, team_id, status, registered_by)
       VALUES ($1, $2, 'pending', $3)`,
      [contestId, teamId, organizerId],
    )).rejects.toMatchObject({ code: '23505' })

    const otherContestId = await createContest(`other-${randomUUID()}`)
    await expect(database.pool.query(
      `INSERT INTO participations (contest_id, team_id, division_id, status, registered_by)
       VALUES ($1, $2, $3, 'pending', $4)`,
      [otherContestId, teamId, division.rows[0]!.id, organizerId],
    )).rejects.toMatchObject({ code: '23503' })
  })

  it('deduplicates public timeline events within a contest', async () => {
    const contestId = await createContest(`timeline-${randomUUID()}`)
    await database.pool.query(
      `INSERT INTO contest_events (contest_id, event_type, event_key)
       VALUES ($1, 'contest_phase_changed', 'phase:running')`,
      [contestId],
    )
    await expect(database.pool.query(
      `INSERT INTO contest_events (contest_id, event_type, event_key)
       VALUES ($1, 'contest_phase_changed', 'phase:running')`,
      [contestId],
    )).rejects.toMatchObject({ code: '23505' })
    await expect(database.pool.query(
      `INSERT INTO contest_events (contest_id, event_type, event_key)
       VALUES ($1, 'user_banned', 'security:event')`,
      [contestId],
    )).rejects.toMatchObject({ code: '22P02' })
  })
})
