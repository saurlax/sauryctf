import { randomUUID } from 'node:crypto'
import { PostgresTestClient as Client, type PostgresTestConnection as PoolClient } from '../../test-support/postgres-database'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { runPostgresTestMigrations } from '../../test-support/postgres-database'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName(): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected test database name')
  return `"${databaseName}"`
}

describeWithPostgres('team authority schema', () => {
  let admin: Client
  let database: PostgresTestDatabase
  let userSequence = 0

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createPostgresTestDatabase({ connectionString: url.toString(), maxConnections: 8 })
    await runPostgresTestMigrations(database)
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

  async function createUser(): Promise<string> {
    userSequence += 1
    const username = `TeamUser${userSequence}`
    const email = `team-user-${userSequence}@example.test`
    const user = await database.executor.query<{ id: string }>(
      `INSERT INTO users (username, username_normalized, email, email_normalized)
       VALUES ($1::varchar(64), lower($1::varchar(64)), $2::varchar(320), lower($2::varchar(320)))
       RETURNING id`,
      [username, email],
    )
    return user.rows[0]!.id
  }

  async function createTeam(captainId: string): Promise<string> {
    const connection = await database.connect()
    try {
      await connection.query('BEGIN')
      const team = await connection.query<{ id: string }>(
        `INSERT INTO teams (name, name_normalized, created_by)
         VALUES ($1::varchar(80), lower($1::varchar(80)), $2) RETURNING id`,
        [`Team-${randomUUID()}`, captainId],
      )
      await connection.query(
        `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'captain')`,
        [team.rows[0]!.id, captainId],
      )
      await connection.query('COMMIT')
      return team.rows[0]!.id
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
  }

  async function transferCaptain(teamId: string, previousCaptainId: string, nextCaptainId: string): Promise<void> {
    const connection = await database.connect()
    try {
      await connection.query('BEGIN')
      await connection.query(
        `UPDATE team_members SET role = 'member' WHERE team_id = $1 AND user_id = $2`,
        [teamId, previousCaptainId],
      )
      await connection.query(
        `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'captain')`,
        [teamId, nextCaptainId],
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
  }

  it('allows one user to join at most one team under concurrency', async () => {
    const [captainA, captainB, joiningUser] = await Promise.all([createUser(), createUser(), createUser()])
    const [teamA, teamB] = await Promise.all([createTeam(captainA), createTeam(captainB)])

    const outcomes = await Promise.allSettled([
      database.executor.query('INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)', [teamA, joiningUser]),
      database.executor.query('INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)', [teamB, joiningUser]),
    ])
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1)

    const memberships = await database.executor.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM team_members WHERE user_id = $1',
      [joiningUser],
    )
    expect(memberships.rows[0]!.count).toBe('1')
  })

  it('keeps exactly one captain during concurrent transfer attempts', async () => {
    const [captain, candidateA, candidateB] = await Promise.all([createUser(), createUser(), createUser()])
    const teamId = await createTeam(captain)
    const outcomes = await Promise.allSettled([
      transferCaptain(teamId, captain, candidateA),
      transferCaptain(teamId, captain, candidateB),
    ])

    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1)
    const captains = await database.executor.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM team_members WHERE team_id = $1 AND role = 'captain'`,
      [teamId],
    )
    expect(captains.rows[0]!.count).toBe('1')
  })

  it('requires invitation rotation to leave one current digest', async () => {
    const captain = await createUser()
    const teamId = await createTeam(captain)
    await database.executor.query(
      `INSERT INTO team_invites (team_id, token_digest, generation, created_by)
       VALUES ($1, $2, 1, $3)`,
      [teamId, Buffer.from('invite-one'), captain],
    )
    await expect(database.executor.query(
      `INSERT INTO team_invites (team_id, token_digest, generation, created_by)
       VALUES ($1, $2, 2, $3)`,
      [teamId, Buffer.from('invite-two'), captain],
    )).rejects.toMatchObject({ code: '23505' })

    const connection: PoolClient = await database.connect()
    try {
      await connection.query('BEGIN')
      await connection.query(
        'UPDATE team_invites SET revoked_at = now() WHERE team_id = $1 AND revoked_at IS NULL',
        [teamId],
      )
      await connection.query(
        `INSERT INTO team_invites (team_id, token_digest, generation, created_by)
         VALUES ($1, $2, 2, $3)`,
        [teamId, Buffer.from('invite-two'), captain],
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

    const current = await database.executor.query<{ generation: number }>(
      'SELECT generation FROM team_invites WHERE team_id = $1 AND revoked_at IS NULL',
      [teamId],
    )
    expect(current.rows).toEqual([{ generation: 2 }])
  })
})
