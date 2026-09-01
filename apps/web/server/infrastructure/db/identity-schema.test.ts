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

describeWithPostgres('identity authority schema', () => {
  let admin: Client
  let database: DatabaseClient

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 2 })
    await runMigrations(database)
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

  async function insertUser(username: string, email: string) {
    return database.pool.query<{ id: string }>(
      `INSERT INTO users (username, username_normalized, email, email_normalized)
       VALUES ($1::varchar(64), lower($1::varchar(64)), $2::varchar(320), lower($2::varchar(320)))
       RETURNING id`,
      [username, email],
    )
  }

  it('enforces normalized username and email uniqueness', async () => {
    await insertUser('PlayerOne', 'player-one@example.test')
    await expect(insertUser('playerone', 'other@example.test')).rejects.toMatchObject({ code: '23505' })
    await expect(insertUser('OtherPlayer', 'PLAYER-ONE@example.test')).rejects.toMatchObject({ code: '23505' })
  })

  it('stores one scrypt credential and one allowed global role per user', async () => {
    const user = await insertUser('CredentialUser', 'credential@example.test')
    const userId = user.rows[0]!.id

    await database.pool.query(
      'INSERT INTO credentials (user_id, password_hash) VALUES ($1, $2)',
      [userId, '$scrypt$test-digest'],
    )
    await database.pool.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [userId, 'organizer'])

    await expect(database.pool.query(
      'INSERT INTO credentials (user_id, password_hash) VALUES ($1, $2)',
      [userId, '$scrypt$duplicate'],
    )).rejects.toMatchObject({ code: '23505' })
    await expect(database.pool.query(
      'UPDATE user_roles SET role = $2 WHERE user_id = $1',
      [userId, 'judge'],
    )).rejects.toMatchObject({ code: '22P02' })
  })

  it('stores only unique email token digests with explicit purpose and expiry', async () => {
    const user = await insertUser('TokenUser', 'token@example.test')
    const userId = user.rows[0]!.id
    const digest = Buffer.from('digest-value')

    await database.pool.query(
      `INSERT INTO email_tokens (user_id, purpose, token_digest, target_email_normalized, expires_at)
       VALUES ($1, 'verify_email', $2, $3, now() + interval '15 minutes')`,
      [userId, digest, 'token@example.test'],
    )
    await expect(database.pool.query(
      `INSERT INTO email_tokens (user_id, purpose, token_digest, target_email_normalized, expires_at)
       VALUES ($1, 'reset_password', $2, $3, now() + interval '15 minutes')`,
      [userId, digest, 'token@example.test'],
    )).rejects.toMatchObject({ code: '23505' })
  })

  it('has session_version but no server-side Session table', async () => {
    const columns = await database.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'session_version'`,
    )
    const sessions = await database.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND lower(table_name) IN ('session', 'sessions')`,
    )

    expect(columns.rows).toEqual([{ column_name: 'session_version' }])
    expect(sessions.rows).toEqual([])
  })
})
