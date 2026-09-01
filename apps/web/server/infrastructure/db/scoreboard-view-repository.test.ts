import { randomBytes, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ScoreboardViewService } from '../../domains/scoreboards/view-service'
import { ContestScoringReplayService } from '../../domains/submissions/scoring-replay'
import { createDatabaseClient, type DatabaseClient } from './client'
import { runMigrations } from './migrate'
import { PostgresScoreboardViewRepository } from './scoreboard-view-repository'
import { PostgresScoringReplayRepository } from './scoring-replay-repository'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName() {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected database name')
  return `"${databaseName}"`
}

describeWithPostgres('PostgreSQL role-aware scoreboard snapshots', () => {
  let admin: Client
  let database: DatabaseClient
  let contestId: string
  let currentTime = new Date('2026-09-01T08:05:00.000Z')
  const freezeAt = new Date('2026-09-01T08:00:00.000Z')
  const endAt = new Date('2026-09-01T08:10:00.000Z')

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 8 })
    await runMigrations(database)

    const user = await database.pool.query<{ id: string }>(
      `INSERT INTO users
         (username, username_normalized, email, email_normalized, email_verified_at)
       VALUES ('ScoreboardUser', 'scoreboarduser',
               'scoreboard@example.test', 'scoreboard@example.test', $1)
       RETURNING id`,
      [new Date('2026-09-01T07:00:00.000Z')],
    )
    const userId = user.rows[0]!.id
    const contest = await database.pool.query<{ id: string }>(
      `INSERT INTO contests
         (title, slug, publication_status, visibility, start_at, end_at,
          scoreboard_freeze_at, created_by)
       VALUES ('Scoreboard Contest', $1, 'draft', 'public', $2, $3, $4, $5)
       RETURNING id`,
      [
        `scoreboard-${randomUUID()}`,
        new Date('2026-09-01T07:00:00.000Z'),
        endAt,
        freezeAt,
        userId,
      ],
    )
    contestId = contest.rows[0]!.id

    const template = await database.pool.query<{ id: string }>(
      `INSERT INTO challenge_templates (name, slug, created_by)
       VALUES ('Scoreboard Template', $1, $2) RETURNING id`,
      [`scoreboard-template-${randomUUID()}`, userId],
    )
    const version = await database.pool.query<{ id: string }>(
      `INSERT INTO challenge_template_versions
         (template_id, version_number, title, category, description,
          flag_policy, scoring_policy, created_by)
       VALUES ($1, 1, 'Snapshot Challenge', 'misc', 'Statement',
               '{"type":"static","digest":"masked"}',
               '{"type":"fixed-v1","points":500}', $2)
       RETURNING id`,
      [template.rows[0]!.id, userId],
    )
    const challenge = await database.pool.query<{ id: string }>(
      `INSERT INTO contest_challenges
         (contest_id, source_template_id, source_version_id, title, category,
          description, flag_policy, scoring_policy)
       VALUES ($1, $2, $3, 'Snapshot Challenge', 'misc', 'Statement',
               '{"type":"static","digest":"masked"}',
               '{"type":"fixed-v1","points":500}')
       RETURNING id`,
      [contestId, template.rows[0]!.id, version.rows[0]!.id],
    )
    const challengeId = challenge.rows[0]!.id
    await database.pool.query(
      `UPDATE contests
       SET publication_status = 'published', published_at = $2, updated_at = $2
       WHERE id = $1`,
      [contestId, new Date('2026-09-01T07:00:00.000Z')],
    )

    for (const [index, solvedAt] of [
      new Date('2026-09-01T07:55:00.000Z'),
      freezeAt,
    ].entries()) {
      const player = await database.pool.query<{ id: string }>(
        `INSERT INTO users
           (username, username_normalized, email, email_normalized, email_verified_at)
         VALUES ($1, $2, $3, $3, $4) RETURNING id`,
        [
          `ScoreboardPlayer${index + 1}`,
          `scoreboardplayer${index + 1}`,
          `scoreboard-player-${index + 1}@example.test`,
          new Date('2026-09-01T07:00:00.000Z'),
        ],
      )
      const playerId = player.rows[0]!.id
      const connection = await database.pool.connect()
      let teamId: string
      try {
        await connection.query('BEGIN')
        const team = await connection.query<{ id: string }>(
          `INSERT INTO teams (name, name_normalized, created_by)
           VALUES ($1, $2, $3) RETURNING id`,
          [`Scoreboard Team ${index + 1}`, `scoreboard team ${index + 1}`, playerId],
        )
        teamId = team.rows[0]!.id
        await connection.query(
          `INSERT INTO team_members (team_id, user_id, role)
           VALUES ($1, $2, 'captain')`,
          [teamId, playerId],
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
      const participation = await database.pool.query<{ id: string }>(
        `INSERT INTO participations
           (contest_id, team_id, status, registered_by, reviewed_by, reviewed_at)
         VALUES ($1, $2, 'accepted', $3, $3, $4) RETURNING id`,
        [contestId, teamId, playerId, new Date('2026-09-01T07:30:00.000Z')],
      )
      const submission = await database.pool.query<{ id: string }>(
        `INSERT INTO submissions
           (contest_id, contest_challenge_id, participation_id, user_id, mode,
            result, answer_digest, answer_ciphertext, request_id, submitted_at)
         VALUES ($1, $2, $3, $4, 'official', 'correct', $5, $6, $7, $8)
         RETURNING id`,
        [
          contestId,
          challengeId,
          participation.rows[0]!.id,
          playerId,
          randomBytes(32),
          randomBytes(33),
          randomUUID(),
          solvedAt,
        ],
      )
      await database.pool.query(
        `INSERT INTO solves
           (submission_id, contest_id, contest_challenge_id, participation_id,
            mode, awarded_score, solve_order, solved_at)
         VALUES ($1, $2, $3, $4, 'official', 500, $5, $6)`,
        [
          submission.rows[0]!.id,
          contestId,
          challengeId,
          participation.rows[0]!.id,
          index + 1,
          solvedAt,
        ],
      )
    }
    await database.pool.query(
      `INSERT INTO scoreboard_versions (contest_id, version, updated_at)
       VALUES ($1, 2, $2)`,
      [contestId, freezeAt],
    )
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

  it('persists the strict freeze boundary while privileged views remain current', async () => {
    const repository = new PostgresScoreboardViewRepository(database.pool)
    const replays = new ContestScoringReplayService(
      new PostgresScoringReplayRepository(database.pool),
    )
    const service = new ScoreboardViewService(repository, replays, undefined, () => currentTime)

    const frozen = await service.read({
      contestId,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'overall' },
    })
    expect(frozen).toMatchObject({ view: 'public', state: 'frozen', version: 1 })
    expect(frozen.board.rows.map(row => row.totalPoints)).toEqual([500, 0])
    expect(frozen.board.challenges[0]).toMatchObject({ officialSolveCount: 1 })

    for (const viewerRole of ['organizer', 'admin'] as const) {
      const internal = await service.read({
        contestId,
        view: 'internal',
        viewerRole,
        scope: { type: 'overall' },
      })
      expect(internal).toMatchObject({ view: 'internal', state: 'live', version: 2 })
      expect(internal.board.rows.map(row => row.totalPoints)).toEqual([500, 500])
      expect(internal.board.challenges[0]).toMatchObject({ officialSolveCount: 2 })
    }

    const frozenAgain = await service.read({
      contestId,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'overall' },
    })
    expect(frozenAgain).toEqual(frozen)

    currentTime = new Date('2026-09-01T08:11:00.000Z')
    const settled = await service.read({
      contestId,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'overall' },
    })
    expect(settled).toMatchObject({ view: 'public', state: 'settled', version: 2 })
    expect(settled.board.rows.map(row => row.totalPoints)).toEqual([500, 500])

    const snapshots = await database.pool.query<{
      view: string
      version: string
    }>(
      `SELECT view::text, version::text
       FROM scoreboard_snapshots
       WHERE contest_id = $1
       ORDER BY view, version`,
      [contestId],
    )
    expect(snapshots.rows).toEqual([
      { view: 'internal', version: '2' },
      { view: 'public', version: '1' },
      { view: 'public', version: '2' },
    ])
  })
})
