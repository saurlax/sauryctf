import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { PostgresTestClient as Client } from '../../test-support/postgres-database'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FlagVerifier, staticFlagDigest, VersionedFlagKeyring } from '../../domains/challenges/flag-verifier'
import type { SessionSubject } from '../../domains/identity/repository'
import { ScoreboardViewService } from '../../domains/scoreboards/view-service'
import { SubmissionService } from '../../domains/submissions/service'
import { ContestScoringReplayService } from '../../domains/submissions/scoring-replay'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { runPostgresTestMigrations } from '../../test-support/postgres-database'
import { PostgresScoreboardViewRepository } from '../db/scoreboard-view-repository'
import { PostgresScoringReplayRepository } from '../db/scoring-replay-repository'
import { PostgresSubmissionRepository } from '../db/submission-repository'
import { AesGcmSubmissionAnswerProtector } from '../security/submission-answer-protector'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeCapacity = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_capacity_${randomUUID().replaceAll('-', '')}`
const teamCount = 300
const concurrentPlayerCount = 1_000
const runningInstanceCount = 1_000
const challengeCount = 20
const submissionBurstCount = 200
const targetSubmissionRps = 200
const correctSubmissionCount = 20
const submissionP95ThresholdMs = 300
const scoreboardVisibilityThresholdMs = 5_000
const testTime = new Date()

interface CapacityFixture {
  adminId: string
  contestId: string
  actors: SessionSubject[]
  challengeIds: string[]
  flags: string[]
}

interface TimedSubmission {
  index: number
  startedAtMs: number
  completedAtMs: number
  latencyMs: number
  correct: boolean
  result: 'correct' | 'incorrect' | 'already_solved'
  error: string | null
}

describeCapacity('first-release capacity acceptance', () => {
  let admin: Client
  let database: PostgresTestDatabase
  let fixture: CapacityFixture
  let submissions: SubmissionService
  let scoreboards: ScoreboardViewService

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    database = createPostgresTestDatabase({
      connectionString: databaseUrl(adminConnectionString!),
      applicationName: 'sauryctf-capacity-acceptance',
      maxConnections: 96,
      connectionTimeoutMs: 10_000,
    })
    await runPostgresTestMigrations(database)
    fixture = await seedCapacityFixture(database)

    submissions = new SubmissionService(
      new PostgresSubmissionRepository(database.executor),
      new FlagVerifier(new VersionedFlagKeyring({})),
      { consume: async () => ({ allowed: true, retryAfterMs: 0 }) },
      new AesGcmSubmissionAnswerProtector(Buffer.alloc(32, 23)),
      () => testTime,
    )
    scoreboards = new ScoreboardViewService(
      new PostgresScoreboardViewRepository(database.executor),
      new ContestScoringReplayService(new PostgresScoringReplayRepository(database.executor)),
      undefined,
      () => testTime,
    )
  }, 60_000)

  afterAll(async () => {
    if (database) await database.close()
    if (admin) {
      await waitForDatabaseConnectionsToClose(admin)
      await admin.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName()}`)
      await admin.end()
    }
  })

  it('sustains the declared team, player, instance, submission and scoreboard baseline', async () => {
    const seeded = await database.executor.query<{
      teams: number
      users: number
      accepted_participations: number
      running_instances: number
    }>(`
      SELECT
        (SELECT count(*)::int FROM teams) AS teams,
        (SELECT count(*)::int FROM users WHERE username_normalized LIKE 'capacity-player-%') AS users,
        (SELECT count(*)::int FROM participations WHERE contest_id = $1 AND status = 'accepted') AS accepted_participations,
        (SELECT count(*)::int FROM instances WHERE contest_id = $1 AND desired_state = 'running'
          AND observed_state = 'running' AND desired_generation = observed_generation) AS running_instances`,
    [fixture.contestId])
    expect(seeded.rows[0]).toEqual({
      teams: teamCount,
      users: concurrentPlayerCount,
      accepted_participations: teamCount,
      running_instances: runningInstanceCount,
    })

    const initialBoard = await readPublicScoreboard()
    expect(initialBoard).toMatchObject({ version: 0, freshness: 'current' })
    expect(initialBoard.board.rows).toHaveLength(teamCount)

    const concurrentReadStartedAt = performance.now()
    const concurrentBoards = await Promise.all(Array.from(
      { length: concurrentPlayerCount },
      () => timed(() => readPublicScoreboard()),
    ))
    const concurrentReadDurationMs = performance.now() - concurrentReadStartedAt
    expect(concurrentBoards).toHaveLength(concurrentPlayerCount)
    expect(concurrentBoards.every(read => read.value.version === 0)).toBe(true)

    const submissionsAt = performance.now() + 100
    const submitted = await Promise.all(Array.from(
      { length: submissionBurstCount },
      (_, index) => scheduleSubmission(index, submissionsAt),
    ))
    const failures = submitted.filter(result => result.error !== null)
    expect(failures).toEqual([])
    expect(submitted.filter(result => result.correct)).toHaveLength(correctSubmissionCount)
    expect(submitted.filter(result => result.result === 'incorrect'))
      .toHaveLength(submissionBurstCount - correctSubmissionCount)

    const latencies = submitted.map(result => result.latencyMs)
    const submissionP95Ms = percentile(latencies, 0.95)
    const submissionP99Ms = percentile(latencies, 0.99)
    const firstArrivalMs = Math.min(...submitted.map(result => result.startedAtMs))
    const lastArrivalMs = Math.max(...submitted.map(result => result.startedAtMs))
    const arrivalSpanMs = lastArrivalMs - firstArrivalMs
    const latestCorrectCommitMs = Math.max(
      ...submitted.filter(result => result.correct).map(result => result.completedAtMs),
    )

    const finalBoard = await waitForScoreboardVersion(correctSubmissionCount)
    const scoreboardVisibleAtMs = performance.now()
    const scoreboardVisibilityMs = scoreboardVisibleAtMs - latestCorrectCommitMs
    expect(finalBoard.board.rows.filter(row => row.officialSolveCount > 0))
      .toHaveLength(correctSubmissionCount)
    expect(finalBoard.board.challenges.reduce((total, challenge) =>
      total + challenge.officialSolveCount, 0)).toBe(correctSubmissionCount)

    const report = {
      schema: 'sauryctf.capacity-acceptance.v1',
      generated_at: new Date().toISOString(),
      scale: {
        teams: teamCount,
        concurrent_players: concurrentPlayerCount,
        accepted_participations: teamCount,
        running_instances: runningInstanceCount,
        challenges: challengeCount,
        submission_burst: {
          requests: submissionBurstCount,
          target_requests_per_second: targetSubmissionRps,
          correct_requests: correctSubmissionCount,
          incorrect_requests: submissionBurstCount - correctSubmissionCount,
        },
      },
      measurements: {
        concurrent_scoreboard_reads_duration_ms: round(concurrentReadDurationMs),
        concurrent_scoreboard_read_p95_ms: round(percentile(
          concurrentBoards.map(read => read.durationMs),
          0.95,
        )),
        submission_arrival_span_ms: round(arrivalSpanMs),
        submission_p50_ms: round(percentile(latencies, 0.5)),
        submission_p95_ms: round(submissionP95Ms),
        submission_p99_ms: round(submissionP99Ms),
        submission_max_ms: round(Math.max(...latencies)),
        scoreboard_visibility_ms: round(scoreboardVisibilityMs),
        scoreboard_version: finalBoard.version,
      },
      thresholds: {
        submission_p95_ms: submissionP95ThresholdMs,
        scoreboard_visibility_ms: scoreboardVisibilityThresholdMs,
      },
      passed: submissionP95Ms < submissionP95ThresholdMs
        && scoreboardVisibilityMs < scoreboardVisibilityThresholdMs,
    }
    await persistReport(report)
    console.log(`CAPACITY_ACCEPTANCE ${JSON.stringify(report)}`)

    expect(arrivalSpanMs).toBeLessThan(1_250)
    expect(submissionP95Ms).toBeLessThan(submissionP95ThresholdMs)
    expect(scoreboardVisibilityMs).toBeLessThan(scoreboardVisibilityThresholdMs)

    async function readPublicScoreboard() {
      return scoreboards.read({
        contestId: fixture.contestId,
        view: 'public',
        viewerRole: 'user',
        scope: { type: 'overall' },
      })
    }

    async function scheduleSubmission(index: number, firstStartMs: number): Promise<TimedSubmission> {
      const scheduledAt = firstStartMs + index * (1_000 / targetSubmissionRps)
      await sleep(Math.max(0, scheduledAt - performance.now()))
      const startedAtMs = performance.now()
      const challengeIndex = Math.floor(index / 10) % challengeCount
      const correct = index % 10 === 0
      try {
        const outcome = await submissions.verifyFlag(fixture.actors[index]!, {
          contestId: fixture.contestId,
          challengeId: fixture.challengeIds[challengeIndex]!,
          submittedFlag: correct
            ? fixture.flags[challengeIndex]!
            : `flag{capacity-incorrect-${index}-${randomUUID()}}`,
          requestId: randomUUID(),
        })
        const completedAtMs = performance.now()
        return {
          index,
          startedAtMs,
          completedAtMs,
          latencyMs: completedAtMs - startedAtMs,
          correct: outcome.correct,
          result: outcome.result,
          error: null,
        }
      }
      catch (error) {
        const completedAtMs = performance.now()
        return {
          index,
          startedAtMs,
          completedAtMs,
          latencyMs: completedAtMs - startedAtMs,
          correct: false,
          result: 'incorrect',
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        }
      }
    }
  }, 120_000)

  async function waitForScoreboardVersion(expectedVersion: number) {
    const deadline = performance.now() + scoreboardVisibilityThresholdMs
    while (true) {
      const board = await scoreboards.read({
        contestId: fixture.contestId,
        view: 'public',
        viewerRole: 'user',
        scope: { type: 'overall' },
      })
      if (board.version >= expectedVersion) return board
      if (performance.now() >= deadline) return board
      await sleep(25)
    }
  }
})

async function seedCapacityFixture(database: PostgresTestDatabase): Promise<CapacityFixture> {
  const admin = await database.executor.query<{ id: string }>(`
    INSERT INTO users
      (username, username_normalized, email, email_normalized, email_verified_at)
    VALUES ('CapacityAdmin', 'capacityadmin', 'capacity-admin@example.test',
      'capacity-admin@example.test', $1)
    RETURNING id::text`, [testTime])
  const adminId = admin.rows[0]!.id
  await database.executor.query(
    `INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`,
    [adminId],
  )

  const players = await database.executor.query<{ id: string, username: string }>(`
    INSERT INTO users
      (username, username_normalized, email, email_normalized, email_verified_at)
    SELECT
      'CapacityPlayer-' || lpad(series::text, 4, '0'),
      'capacity-player-' || lpad(series::text, 4, '0'),
      'capacity-player-' || lpad(series::text, 4, '0') || '@example.test',
      'capacity-player-' || lpad(series::text, 4, '0') || '@example.test',
      $1
    FROM generate_series(1, $2::integer) series
    ORDER BY series
    RETURNING id::text, username`, [testTime, concurrentPlayerCount])
  const orderedPlayers = players.rows.toSorted((left, right) => left.username.localeCompare(right.username))
  await database.executor.query(`
    INSERT INTO user_roles (user_id, role)
    SELECT id, 'user' FROM users WHERE username_normalized LIKE 'capacity-player-%'`)

  const connection = await database.connect()
  let teamIds: string[]
  try {
    await connection.query('BEGIN')
    await connection.query('SET CONSTRAINTS ALL DEFERRED')
    const teams = await connection.query<{ id: string, name_normalized: string }>(`
      INSERT INTO teams (name, name_normalized, created_by)
      SELECT
        'Capacity Team ' || lpad(ordinality::text, 3, '0'),
        'capacity team ' || lpad(ordinality::text, 3, '0'),
        user_id
      FROM unnest($1::uuid[]) WITH ORDINALITY AS captain(user_id, ordinality)
      RETURNING id::text, name_normalized`, [orderedPlayers.slice(0, teamCount).map(player => player.id)])
    teamIds = teams.rows
      .toSorted((left, right) => left.name_normalized.localeCompare(right.name_normalized))
      .map(team => team.id)
    await connection.query(`
      INSERT INTO team_members (team_id, user_id, role)
      SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::team_member_role[])`, [
      orderedPlayers.map((_, index) => teamIds[index % teamCount]!),
      orderedPlayers.map(player => player.id),
      orderedPlayers.map((_, index) => index < teamCount ? 'captain' : 'member'),
    ])
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
      (title, slug, description, publication_status, visibility,
       registration_strategy, start_at, end_at, practice_enabled,
       min_team_size, max_team_size, published_at, created_by)
    VALUES ('Capacity Acceptance', $1, 'First-release capacity acceptance fixture',
      'draft', 'public', 'auto_accept', $2, $3, false, 1, 5, NULL, $4)
    RETURNING id::text`, [
    `capacity-${randomUUID()}`,
    new Date(testTime.getTime() - 60_000),
    new Date(testTime.getTime() + 60 * 60_000),
    adminId,
  ])
  const contestId = contest.rows[0]!.id

  const participations = await database.executor.query<{ id: string, team_id: string }>(`
    INSERT INTO participations
      (contest_id, team_id, status, registered_by, reviewed_by,
       review_reason, registered_at, reviewed_at)
    SELECT $1, team_id, 'accepted', captain_id, $2,
      'Capacity acceptance seed', $3, $3
    FROM unnest($4::uuid[], $5::uuid[]) AS seeded(team_id, captain_id)
    RETURNING id::text, team_id::text`, [
    contestId,
    adminId,
    testTime,
    teamIds,
    orderedPlayers.slice(0, teamCount).map(player => player.id),
  ])
  const participationByTeam = new Map(
    participations.rows.map(participation => [participation.team_id, participation.id]),
  )

  const challengeIds: string[] = []
  const flags: string[] = []
  for (let index = 0; index < challengeCount; index += 1) {
    const flag = `flag{capacity-correct-${index}}`
    const template = await database.executor.query<{ id: string }>(`
      INSERT INTO challenge_templates
        (name, slug, created_by, latest_version)
      VALUES ($1, $2, $3, 1)
      RETURNING id::text`, [
      `Capacity Challenge ${index + 1}`,
      `capacity-challenge-${index + 1}-${randomUUID()}`,
      adminId,
    ])
    const templateId = template.rows[0]!.id
    const version = await database.executor.query<{ id: string }>(`
      INSERT INTO challenge_template_versions
        (template_id, version_number, title, category, description,
         flag_format, flag_policy, scoring_policy, instance_policy, created_by)
      VALUES ($1, 1, $2, 'web', 'Capacity acceptance challenge',
        'flag{...}', $3, $4, $5, $6)
      RETURNING id::text`, [
      templateId,
      `Capacity Challenge ${index + 1}`,
      { type: 'static', digest: staticFlagDigest(flag) },
      { type: 'fixed-v1', points: 100 },
      {
        type: 'dynamic',
        provider: 'docker',
        image: 'nginx:alpine',
        entry_port: 80,
        entry_protocol: 'http',
      },
      adminId,
    ])
    const challenge = await database.executor.query<{ id: string }>(`
      INSERT INTO contest_challenges
        (contest_id, source_template_id, source_version_id, title, category,
         description, flag_format, flag_policy, scoring_policy, instance_policy,
         enabled, sort_order)
      VALUES ($1, $2, $3, $4, 'web', 'Capacity acceptance challenge',
        'flag{...}', $5, $6, $7, true, $8)
      RETURNING id::text`, [
      contestId,
      templateId,
      version.rows[0]!.id,
      `Capacity Challenge ${index + 1}`,
      { type: 'static', digest: staticFlagDigest(flag) },
      { type: 'fixed-v1', points: 100 },
      {
        type: 'dynamic',
        provider: 'docker',
        image: 'nginx:alpine',
        entry_port: 80,
        entry_protocol: 'http',
      },
      index,
    ])
    challengeIds.push(challenge.rows[0]!.id)
    flags.push(flag)
  }

  const instanceParticipationIds = Array.from({ length: runningInstanceCount }, (_, index) => {
    const teamId = teamIds[index % teamCount]!
    return participationByTeam.get(teamId)!
  })
  const instanceChallengeIds = Array.from({ length: runningInstanceCount }, (_, index) =>
    challengeIds[Math.floor(index / teamCount)]!,
  )
  await database.executor.query(`
    INSERT INTO instances
      (contest_id, contest_challenge_id, participation_id, provider,
       desired_state, desired_generation, observed_state, observed_generation,
       expires_at, provider_resource_id, entrypoints, last_observed_at)
    SELECT $1, challenge_id, participation_id, 'docker',
      'running', 1, 'running', 1, $2,
      'capacity-instance-' || ordinality,
      jsonb_build_array(jsonb_build_object(
        'name', 'http', 'protocol', 'http',
        'url', 'https://capacity.example.test/' || ordinality,
        'host', 'capacity.example.test', 'port', 443)),
      $3
    FROM unnest($4::uuid[], $5::uuid[])
      WITH ORDINALITY AS seeded(participation_id, challenge_id, ordinality)`, [
    contestId,
    new Date(testTime.getTime() + 60 * 60_000),
    testTime,
    instanceParticipationIds,
    instanceChallengeIds,
  ])
  await database.executor.query(`
    UPDATE contests
    SET publication_status = 'published', published_at = $2,
        version = version + 1, updated_at = $2
    WHERE id = $1`, [contestId, testTime])

  return {
    adminId,
    contestId,
    actors: orderedPlayers.map(player => ({
      userId: player.id,
      username: player.username,
      email: `${player.username.toLowerCase()}@example.test`,
      emailVerified: true,
      status: 'active',
      role: 'user',
      sessionVersion: 1,
      mustChangePassword: false,
    })),
    challengeIds,
    flags,
  }
}

function quotedDatabaseName(): string {
  if (!/^sauryctf_capacity_[a-f0-9]{32}$/u.test(databaseName)) {
    throw new Error('Unexpected capacity test database name')
  }
  return `"${databaseName}"`
}

function databaseUrl(source: string): string {
  const url = new URL(source)
  url.pathname = `/${databaseName}`
  return url.toString()
}

async function timed<T>(operation: () => Promise<T>) {
  const startedAt = performance.now()
  const value = await operation()
  return { value, durationMs: performance.now() - startedAt }
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) throw new RangeError('Cannot calculate a percentile without values')
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]!
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function persistReport(report: unknown): Promise<void> {
  const path = process.env.CAPACITY_REPORT_PATH
  if (!path) return
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

async function waitForDatabaseConnectionsToClose(admin: Client): Promise<void> {
  const deadline = performance.now() + 5_000
  while (true) {
    const result = await admin.query<{ connections: number }>(`
      SELECT count(*)::int AS connections
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`, [databaseName])
    if (result.rows[0]!.connections === 0) return
    if (performance.now() >= deadline) {
      throw new Error(`Capacity test database still has ${result.rows[0]!.connections} connections`)
    }
    await sleep(50)
  }
}
