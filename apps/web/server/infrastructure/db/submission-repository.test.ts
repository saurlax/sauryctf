import { randomUUID } from 'node:crypto'
import { PostgresTestClient as Client } from '../../test-support/postgres-database'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { staticFlagDigest } from '../../domains/challenges/flag-verifier'
import { ContestScoringReplayService } from '../../domains/submissions/scoring-replay'
import type { ChallengeFlagPolicy, ChallengeScoringPolicy } from '../../../shared/contracts/challenges'
import {
  CheatClueRequestConflictError,
  CheatClueReviewConflictError,
  ScoreAdjustmentArchivedContestError,
  ScoreAdjustmentRequestConflictError,
  SubmissionChallengeClosedError,
  SubmissionChallengeUnavailableError,
  SubmissionContestNotRunningError,
  SubmissionCursorInvalidError,
  SubmissionLimitReachedError,
  SubmissionParticipationNotAcceptedError,
  SubmissionRequestConflictError,
  SubmissionTeamRequiredError,
} from '../../domains/submissions/repository'
import { createPublishableChallenge } from '../../test-support/publishable-challenge'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { runPostgresTestMigrations } from '../../test-support/postgres-database'
import { PostgresSubmissionRepository } from './submission-repository'
import { PostgresScoringReplayRepository } from './scoring-replay-repository'
import { AesGcmSubmissionAnswerProtector } from '../security/submission-answer-protector'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`
const at = new Date('2026-09-01T08:00:00.000Z')

function quotedDatabaseName(): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected test database name')
  return `"${databaseName}"`
}

describeWithPostgres('PostgreSQL submission eligibility', () => {
  let admin: Client
  let database: PostgresTestDatabase
  let repository: PostgresSubmissionRepository
  const answers = new AesGcmSubmissionAnswerProtector(Buffer.alloc(32, 7))

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createPostgresTestDatabase({ connectionString: url.toString(), maxConnections: 8 })
    await runPostgresTestMigrations(database)
    repository = new PostgresSubmissionRepository(database.executor)
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

  async function fixture(options: {
    membership?: boolean
    participationStatus?: 'pending' | 'accepted' | 'rejected' | 'withdrawn'
    startAt?: Date
    endAt?: Date
    enabled?: boolean
    publishAt?: Date | null
    closeAt?: Date | null
    submissionLimit?: number | null
    scoringPolicy?: ChallengeScoringPolicy
    flagPolicy?: ChallengeFlagPolicy
    practiceEnabled?: boolean
  } = {}) {
    const suffix = randomUUID()
    const user = await database.executor.query<{ id: string }>(
      `INSERT INTO users
         (username, username_normalized, email, email_normalized, email_verified_at)
       VALUES ($1, $2, $3, $3, $4)
       RETURNING id`,
      [`Player-${suffix}`, `player-${suffix}`, `player-${suffix}@example.test`, at],
    )
    const userId = user.rows[0]!.id
    const connection = await database.connect()
    let teamId: string
    try {
      await connection.query('BEGIN')
      let captainId = userId
      if (options.membership === false) {
        const captain = await connection.query<{ id: string }>(
          `INSERT INTO users
             (username, username_normalized, email, email_normalized, email_verified_at)
           VALUES ($1, $2, $3, $3, $4)
           RETURNING id`,
          [`Captain-${suffix}`, `captain-${suffix}`, `captain-${suffix}@example.test`, at],
        )
        captainId = captain.rows[0]!.id
      }
    const team = await connection.query<{ id: string }>(
        `INSERT INTO teams (name, name_normalized, created_by)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [`Team-${suffix}`, `team-${suffix}`, captainId],
      )
      teamId = team.rows[0]!.id
      await connection.query(
        `INSERT INTO team_members (team_id, user_id, role)
         VALUES ($1, $2, 'captain')`,
        [teamId, captainId],
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
    const contest = await database.executor.query<{ id: string }>(
      `INSERT INTO contests
         (title, slug, start_at, end_at, practice_enabled, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        `Contest-${suffix}`,
        `contest-${suffix}`,
        options.startAt ?? new Date(at.getTime() - 60_000),
        options.endAt ?? new Date(at.getTime() + 60_000),
        options.practiceEnabled ?? false,
        userId,
      ],
    )
    const contestId = contest.rows[0]!.id
    const participationStatus = options.participationStatus ?? 'accepted'
    const reviewed = ['accepted', 'rejected'].includes(participationStatus)
    const withdrawn = participationStatus === 'withdrawn'
    const participation = await database.executor.query<{ id: string }>(
      `INSERT INTO participations
         (contest_id, team_id, status, registered_by, reviewed_by,
          reviewed_at, withdrawn_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        contestId,
        teamId,
        participationStatus,
        userId,
        reviewed ? userId : null,
        reviewed ? at : null,
        withdrawn ? at : null,
      ],
    )
    const challenge = await createPublishableChallenge(database.executor, contestId, userId, {
      enabled: options.enabled,
      publishAt: options.publishAt,
      closeAt: options.closeAt,
      submissionLimit: options.submissionLimit,
      flagPolicy: options.flagPolicy
        ?? { type: 'static', digest: staticFlagDigest('flag{correct}') },
      scoringPolicy: options.scoringPolicy,
    })
    await database.executor.query(
      `UPDATE contests
       SET publication_status = 'published', published_at = $2, updated_at = $2
       WHERE id = $1`,
      [contestId, new Date(at.getTime() - 120_000)],
    )
    return {
      userId,
      teamId,
      teamName: `Team-${suffix}`,
      contestId,
      challengeId: challenge.challengeId,
      participationId: participation.rows[0]!.id,
    }
  }

  async function addParticipant(
    input: Awaited<ReturnType<typeof fixture>>,
    sameTeam = false,
  ) {
    const suffix = randomUUID()
    const user = await database.executor.query<{ id: string }>(
      `INSERT INTO users
         (username, username_normalized, email, email_normalized, email_verified_at)
       VALUES ($1, $2, $3, $3, $4)
       RETURNING id`,
      [`Player-${suffix}`, `player-${suffix}`, `player-${suffix}@example.test`, at],
    )
    const userId = user.rows[0]!.id
    if (sameTeam) {
      await database.executor.query(
        `INSERT INTO team_members (team_id, user_id, role)
         VALUES ($1, $2, 'member')`,
        [input.teamId, userId],
      )
      return { ...input, userId }
    }

    const teamName = `Team-${suffix}`
    const connection = await database.connect()
    try {
      await connection.query('BEGIN')
      const team = await connection.query<{ id: string }>(
        `INSERT INTO teams (name, name_normalized, created_by)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [teamName, teamName.toLowerCase(), userId],
      )
      const teamId = team.rows[0]!.id
      await connection.query(
        `INSERT INTO team_members (team_id, user_id, role)
         VALUES ($1, $2, 'captain')`,
        [teamId, userId],
      )
      const participation = await connection.query<{ id: string }>(
        `INSERT INTO participations
           (contest_id, team_id, status, registered_by, reviewed_by, reviewed_at)
         VALUES ($1, $2, 'accepted', $3, $3, $4)
         RETURNING id`,
        [input.contestId, teamId, userId, at],
      )
      await connection.query('COMMIT')
      return {
        ...input,
        userId,
        teamId,
        teamName,
        participationId: participation.rows[0]!.id,
      }
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
  }

  async function admit(input: Awaited<ReturnType<typeof fixture>>) {
    return repository.admit({
      userId: input.userId,
      contestId: input.contestId,
      challengeId: input.challengeId,
      at,
    })
  }

  function appendCommand(
    input: Awaited<ReturnType<typeof fixture>>,
    answer: string,
    result: 'correct' | 'incorrect',
    requestId = randomUUID(),
    submittedAt = at,
  ) {
    const context = {
      contestId: input.contestId,
      challengeId: input.challengeId,
      participationId: input.participationId,
      teamId: input.teamId,
      teamName: input.teamName,
      userId: input.userId,
      requestId,
    }
    const protectedAnswer = answers.protect(answer, context)
    return {
      context,
      command: {
        userId: input.userId,
        contestId: input.contestId,
        challengeId: input.challengeId,
        at: submittedAt,
        requestId,
        result,
        answerDigest: protectedAnswer.digest,
        answerCiphertext: protectedAnswer.ciphertext,
      },
    }
  }

  function adjustmentCommand(
    input: Awaited<ReturnType<typeof fixture>>,
    pointsDelta: number,
    reason: string,
    requestId = randomUUID(),
  ) {
    return {
      actorId: input.userId,
      contestId: input.contestId,
      participationId: input.participationId,
      pointsDelta,
      reason,
      requestId,
      at,
    }
  }

  it('returns only the authoritative context needed after every eligibility check passes', async () => {
    const input = await fixture()
    await expect(admit(input)).resolves.toEqual({
      contestId: input.contestId,
      challengeId: input.challengeId,
      participationId: input.participationId,
      teamId: input.teamId,
      teamName: input.teamName,
      flagFormat: 'flag{...}',
      flagPolicy: { type: 'static', digest: staticFlagDigest('flag{correct}') },
      scoringPolicy: { type: 'fixed-v1', points: 500 },
      mode: 'official',
    })
  })

  it('rejects a user without current team membership', async () => {
    const input = await fixture({ membership: false })
    await expect(admit(input)).rejects.toBeInstanceOf(SubmissionTeamRequiredError)
  })

  it.each(['pending', 'rejected', 'withdrawn'] as const)(
    'rejects a %s participation before Flag validation',
    async (participationStatus) => {
      const input = await fixture({ participationStatus })
      await expect(admit(input)).rejects.toBeInstanceOf(SubmissionParticipationNotAcceptedError)
    },
  )

  it('rejects a published contest before its UTC start boundary', async () => {
    const input = await fixture({
      startAt: new Date(at.getTime() + 60_000),
      endAt: new Date(at.getTime() + 120_000),
    })
    await expect(admit(input)).rejects.toBeInstanceOf(SubmissionContestNotRunningError)
  })

  it('rejects an ended contest when post-contest practice is disabled', async () => {
    const input = await fixture({ endAt: new Date(at.getTime() - 1) })
    await expect(admit(input)).rejects.toBeInstanceOf(SubmissionContestNotRunningError)
  })

  it('rejects disabled, unreleased, and closed challenges without reading Flag correctness', async () => {
    const disabled = await fixture({ enabled: false })
    const unreleased = await fixture({ publishAt: new Date(at.getTime() + 60_000) })
    const closed = await fixture({ closeAt: new Date(at.getTime() - 1) })
    await expect(admit(disabled)).rejects.toBeInstanceOf(SubmissionChallengeUnavailableError)
    await expect(admit(unreleased)).rejects.toBeInstanceOf(SubmissionChallengeUnavailableError)
    await expect(admit(closed)).rejects.toBeInstanceOf(SubmissionChallengeClosedError)
  })

  it('counts only existing official attempts against the per-team challenge limit', async () => {
    const input = await fixture({ submissionLimit: 1 })
    await database.executor.query(
      `INSERT INTO submissions
         (contest_id, contest_challenge_id, participation_id, user_id,
          mode, result, answer_digest, answer_ciphertext, request_id, submitted_at)
       VALUES ($1, $2, $3, $4, 'official', 'incorrect', $5, $6, $7, $8)`,
      [
        input.contestId,
        input.challengeId,
        input.participationId,
        input.userId,
        Buffer.from(staticFlagDigest('flag{wrong}'), 'hex'),
        Buffer.alloc(33, 1),
        randomUUID(),
        at,
      ],
    )
    await expect(admit(input)).rejects.toBeInstanceOf(SubmissionLimitReachedError)
  })

  it.each([
    ['flag{wrong}', 'incorrect'],
    ['flag{correct}', 'correct'],
  ] as const)('appends one immutable %s answer fact without plaintext storage', async (answer, result) => {
    const input = await fixture()
    const protectedInput = appendCommand(input, answer, result)
    const stored = await repository.append(protectedInput.command)
    expect(stored).toMatchObject({
      contestId: input.contestId,
      challengeId: input.challengeId,
      participationId: input.participationId,
      userId: input.userId,
      mode: 'official',
      result,
      submittedAt: at,
    })

    const persisted = await database.executor.query<{
      answer_digest: Buffer
      answer_ciphertext: Buffer
    }>(
      `SELECT answer_digest, answer_ciphertext
       FROM submissions WHERE id = $1`,
      [stored.id],
    )
    expect(persisted.rows[0]!.answer_digest).toEqual(protectedInput.command.answerDigest)
    expect(persisted.rows[0]!.answer_ciphertext.includes(Buffer.from(answer))).toBe(false)
    expect(answers.reveal(persisted.rows[0]!.answer_ciphertext, protectedInput.context)).toBe(answer)
    await expect(database.executor.query(
      `UPDATE submissions SET result = 'correct' WHERE id = $1`,
      [stored.id],
    )).rejects.toMatchObject({ code: '55000' })
  })

  it('deduplicates the same request and rejects reuse for a different fact', async () => {
    const input = await fixture()
    const protectedInput = appendCommand(input, 'flag{wrong}', 'incorrect')
    const first = await repository.append(protectedInput.command)
    const repeated = await repository.append(protectedInput.command)
    expect(repeated.id).toBe(first.id)
    const count = await database.executor.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM submissions WHERE request_id = $1',
      [protectedInput.command.requestId],
    )
    expect(count.rows[0]!.count).toBe('1')
    await expect(repository.append({
      ...protectedInput.command,
      result: 'correct',
    })).rejects.toBeInstanceOf(SubmissionRequestConflictError)
  })

  it('creates one official solve when two teammates submit the correct Flag concurrently', async () => {
    const captain = await fixture()
    const teammate = await addParticipant(captain, true)
    const outcomes = await Promise.all([
      repository.append(appendCommand(captain, 'flag{correct}', 'correct').command),
      repository.append(appendCommand(teammate, 'flag{correct}', 'correct').command),
    ])

    expect(outcomes.map(item => item.result).sort()).toEqual(['already_solved', 'correct'])
    const facts = await database.executor.query<{ result: string }>(
      `SELECT result::text
       FROM submissions
       WHERE participation_id = $1 AND contest_challenge_id = $2
       ORDER BY submitted_at, id`,
      [captain.participationId, captain.challengeId],
    )
    expect(facts.rows.map(row => row.result).sort()).toEqual(['already_solved', 'correct'])
    const solves = await database.executor.query<{ count: string, first_count: string }>(
      `SELECT count(*)::text AS count,
              count(*) FILTER (WHERE solve_order = 1)::text AS first_count
       FROM solves
       WHERE participation_id = $1 AND contest_challenge_id = $2 AND mode = 'official'`,
      [captain.participationId, captain.challengeId],
    )
    expect(solves.rows[0]).toEqual({ count: '1', first_count: '1' })
  })

  it('assigns one stable first and consecutive solve order under concurrent teams', async () => {
    const firstTeam = await fixture()
    const secondTeam = await addParticipant(firstTeam)
    const thirdTeam = await addParticipant(firstTeam)
    await Promise.all([firstTeam, secondTeam, thirdTeam].map(input => repository.append(
      appendCommand(input, 'flag{correct}', 'correct').command,
    )))

    const ordered = await database.executor.query<{
      participation_id: string
      team_id: string
      solve_order: number
      solved_at: Date
    }>(
      `SELECT s.participation_id, p.team_id, s.solve_order, s.solved_at
       FROM solves s
       JOIN participations p ON p.id = s.participation_id
       WHERE s.contest_challenge_id = $1 AND s.mode = 'official'
       ORDER BY s.solve_order`,
      [firstTeam.challengeId],
    )
    expect(ordered.rows.map(row => row.solve_order)).toEqual([1, 2, 3])
    expect(new Set(ordered.rows.map(row => row.participation_id)).size).toBe(3)
    expect(ordered.rows.every(row => row.solved_at.toISOString() === at.toISOString())).toBe(true)

    const timeline = await database.executor.query<{ count: string, payload: { team_id: string } }>(
      `SELECT (count(*) OVER ())::text AS count, payload
       FROM contest_events
       WHERE contest_id = $1 AND event_type = 'first_solve'`,
      [firstTeam.contestId],
    )
    expect(timeline.rows).toHaveLength(1)
    expect(timeline.rows[0]!.count).toBe('1')
    expect(timeline.rows[0]!.payload.team_id).toBe(ordered.rows[0]!.team_id)
  })

  it('persists the deterministic decay-v1 award and advances one scoreboard version per solve', async () => {
    const firstTeam = await fixture({
      scoringPolicy: {
        type: 'decay-v1',
        initial_points: 500,
        minimum_points: 100,
        decay_solves: 10,
      },
    })
    const secondTeam = await addParticipant(firstTeam)
    const thirdTeam = await addParticipant(firstTeam)
    for (const input of [firstTeam, secondTeam, thirdTeam]) {
      await repository.append(appendCommand(input, 'flag{correct}', 'correct').command)
    }

    const solves = await database.executor.query<{ solve_order: number, awarded_score: number }>(
      `SELECT solve_order, awarded_score
       FROM solves
       WHERE contest_challenge_id = $1 AND mode = 'official'
       ORDER BY solve_order`,
      [firstTeam.challengeId],
    )
    expect(solves.rows).toEqual([
      { solve_order: 1, awarded_score: 500 },
      { solve_order: 2, awarded_score: 461 },
      { solve_order: 3, awarded_score: 427 },
    ])
    const version = await database.executor.query<{ version: string, event_count: string }>(
      `SELECT version::text,
              (SELECT count(*)::text
               FROM domain_outbox
               WHERE aggregate_id = $1
                 AND event_type = 'scoreboard.version_changed') AS event_count
       FROM scoreboard_versions
       WHERE contest_id = $1`,
      [firstTeam.contestId],
    )
    expect(version.rows[0]).toEqual({ version: '3', event_count: '0' })
  })

  it('records positive and negative adjustments idempotently without rewriting solve facts', async () => {
    const input = await fixture()
    const penalty = adjustmentCommand(input, -25, 'Apply the reviewed rule penalty')
    const first = await repository.recordScoreAdjustment(penalty)
    const replayed = await repository.recordScoreAdjustment(penalty)
    expect(replayed).toEqual(first)

    const bonus = adjustmentCommand(input, 50, 'Apply the approved scoring bonus')
    await repository.recordScoreAdjustment(bonus)
    await expect(repository.recordScoreAdjustment({
      ...penalty,
      pointsDelta: -30,
    })).rejects.toBeInstanceOf(ScoreAdjustmentRequestConflictError)

    const facts = await database.executor.query<{
      adjustment_count: string
      adjustment_total: string
      submission_count: string
      solve_count: string
      version: string
      outbox_count: string
      audit_count: string
    }>(
      `SELECT
         (SELECT count(*)::text FROM score_adjustments WHERE contest_id = $1) AS adjustment_count,
         (SELECT sum(points_delta)::text FROM score_adjustments WHERE contest_id = $1) AS adjustment_total,
         (SELECT count(*)::text FROM submissions WHERE contest_id = $1) AS submission_count,
         (SELECT count(*)::text FROM solves WHERE contest_id = $1) AS solve_count,
         (SELECT version::text FROM scoreboard_versions WHERE contest_id = $1) AS version,
         (SELECT count(*)::text FROM domain_outbox
          WHERE aggregate_id = $1 AND payload->>'reason' = 'score_adjustment') AS outbox_count,
         (SELECT count(*)::text FROM audit_events
          WHERE action = 'score.adjustment.recorded'
            AND changes->>'contest_id' = $1::text) AS audit_count`,
      [input.contestId],
    )
    expect(facts.rows[0]).toEqual({
      adjustment_count: '2',
      adjustment_total: '25',
      submission_count: '0',
      solve_count: '0',
      version: '2',
      outbox_count: '0',
      audit_count: '2',
    })

    await database.executor.query(
      `UPDATE contests
       SET publication_status = 'archived', archived_at = $2, updated_at = $2
       WHERE id = $1`,
      [input.contestId, at],
    )
    await expect(repository.recordScoreAdjustment(adjustmentCommand(
      input,
      10,
      'Attempt an archived score correction',
    ))).rejects.toBeInstanceOf(ScoreAdjustmentArchivedContestError)
    const unchanged = await database.executor.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM score_adjustments WHERE contest_id = $1',
      [input.contestId],
    )
    expect(unchanged.rows[0]!.count).toBe('2')
  })

  it('isolates post-contest practice submissions from every official scoring fact', async () => {
    const input = await fixture({
      scoringPolicy: {
        type: 'decay-v1',
        initial_points: 500,
        minimum_points: 100,
        decay_solves: 10,
      },
    })
    const official = await repository.append(
      appendCommand(input, 'flag{correct}', 'correct').command,
    )
    expect(official).toMatchObject({ mode: 'official', result: 'correct' })

    await database.executor.query(
      `UPDATE contests
       SET end_at = $2, practice_enabled = true, updated_at = $3
       WHERE id = $1`,
      [input.contestId, new Date(at.getTime() - 1), at],
    )
    await expect(admit(input)).resolves.toMatchObject({ mode: 'practice' })
    const practice = await repository.append(
      appendCommand(input, 'flag{correct}', 'correct').command,
    )
    const repeatedPractice = await repository.append(
      appendCommand(input, 'flag{correct}', 'correct').command,
    )
    expect(practice).toMatchObject({ mode: 'practice', result: 'correct' })
    expect(repeatedPractice).toMatchObject({ mode: 'practice', result: 'already_solved' })

    const facts = await database.executor.query<{
      official_submissions: string
      practice_submissions: string
      official_solves: string
      practice_solves: string
      official_score: string
      practice_score: string
      scoreboard_version: string
      scoreboard_events: string
      first_solve_events: string
    }>(
      `SELECT
         (SELECT count(*)::text FROM submissions
          WHERE contest_id = $1 AND mode = 'official') AS official_submissions,
         (SELECT count(*)::text FROM submissions
          WHERE contest_id = $1 AND mode = 'practice') AS practice_submissions,
         (SELECT count(*)::text FROM solves
          WHERE contest_id = $1 AND mode = 'official') AS official_solves,
         (SELECT count(*)::text FROM solves
          WHERE contest_id = $1 AND mode = 'practice') AS practice_solves,
         (SELECT coalesce(sum(awarded_score), 0)::text FROM solves
          WHERE contest_id = $1 AND mode = 'official') AS official_score,
         (SELECT coalesce(sum(awarded_score), 0)::text FROM solves
          WHERE contest_id = $1 AND mode = 'practice') AS practice_score,
         (SELECT version::text FROM scoreboard_versions
          WHERE contest_id = $1) AS scoreboard_version,
         (SELECT count(*)::text FROM domain_outbox
          WHERE aggregate_id = $1 AND event_type = 'scoreboard.version_changed') AS scoreboard_events,
         (SELECT count(*)::text FROM contest_events
          WHERE contest_id = $1 AND event_type = 'first_solve') AS first_solve_events`,
      [input.contestId],
    )
    expect(facts.rows[0]).toEqual({
      official_submissions: '1',
      practice_submissions: '2',
      official_solves: '1',
      practice_solves: '1',
      official_score: '500',
      practice_score: '0',
      scoreboard_version: '1',
      scoreboard_events: '0',
      first_solve_events: '1',
    })
  })

  it('creates one deduplicated evidence clue for repeated incorrect answers without automatic punishment', async () => {
    const input = await fixture()
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await repository.append(appendCommand(input, 'flag{same-wrong}', 'incorrect').command)
    }

    const page = await repository.listCheatClues(input.contestId, 'open', undefined, 20)
    const repeated = page.items.filter(clue => clue.clueType === 'repeated_incorrect_answer')
    expect(repeated).toHaveLength(1)
    expect(repeated[0]).toMatchObject({
      contestId: input.contestId,
      challengeId: input.challengeId,
      participationId: input.participationId,
      status: 'open',
      reviewedBy: null,
      reviewedAt: null,
    })
    expect(repeated[0]!.evidence).toMatchObject({
      schema: 'cheat-clue.v1',
      kind: 'repeated_incorrect_answer',
      answer_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      participation_id: input.participationId,
      challenge_id: input.challengeId,
      mode: 'official',
      matching_submission_count: 3,
    })
    const serializedEvidence = JSON.stringify(repeated[0]!.evidence)
    expect(serializedEvidence).not.toContain('flag{same-wrong}')
    expect(serializedEvidence).not.toMatch(/ciphertext|encrypted|plaintext/u)

    const facts = await database.executor.query<{
      user_status: string
      submission_count: string
      solve_count: string
      adjustment_count: string
      scoreboard_version: string | null
    }>(
      `SELECT
         (SELECT status::text FROM users WHERE id = $2) AS user_status,
         (SELECT count(*)::text FROM submissions WHERE contest_id = $1) AS submission_count,
         (SELECT count(*)::text FROM solves WHERE contest_id = $1) AS solve_count,
         (SELECT count(*)::text FROM score_adjustments WHERE contest_id = $1) AS adjustment_count,
         (SELECT version::text FROM scoreboard_versions WHERE contest_id = $1) AS scoreboard_version`,
      [input.contestId, input.userId],
    )
    expect(facts.rows[0]).toEqual({
      user_status: 'active',
      submission_count: '4',
      solve_count: '0',
      adjustment_count: '0',
      scoreboard_version: null,
    })

    await database.executor.query(
      `UPDATE contests
       SET end_at = $2, practice_enabled = true, updated_at = $3
       WHERE id = $1`,
      [input.contestId, new Date(at.getTime() - 1), at],
    )
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await repository.append(appendCommand(input, 'flag{practice-wrong}', 'incorrect').command)
    }
    const unchanged = await database.executor.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM cheat_clues
       WHERE contest_id = $1 AND clue_type = 'repeated_incorrect_answer'`,
      [input.contestId],
    )
    expect(unchanged.rows[0]!.count).toBe('1')
  })

  it('detects shared incorrect answers, abnormal frequency, and foreign team-derived Flags', async () => {
    const sharedOwner = await fixture()
    const sharedPeer = await addParticipant(sharedOwner)
    await repository.append(appendCommand(sharedOwner, 'flag{shared-wrong}', 'incorrect').command)
    await repository.append(appendCommand(sharedPeer, 'flag{shared-wrong}', 'incorrect').command)
    const shared = await database.executor.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM cheat_clues
       WHERE contest_id = $1 AND clue_type = 'shared_incorrect_answer'`,
      [sharedOwner.contestId],
    )
    expect(shared.rows[0]!.count).toBe('2')

    const frequent = await fixture()
    for (let attempt = 0; attempt < 11; attempt += 1) {
      await repository.append(appendCommand(
        frequent,
        `flag{frequency-${attempt}}`,
        'incorrect',
      ).command)
    }
    const frequency = await database.executor.query<{ count: string, evidence: Record<string, unknown> }>(
      `SELECT (count(*) OVER ())::text AS count, evidence
       FROM cheat_clues
       WHERE contest_id = $1 AND clue_type = 'abnormal_submission_frequency'`,
      [frequent.contestId],
    )
    expect(frequency.rows).toHaveLength(1)
    expect(frequency.rows[0]).toMatchObject({
      count: '1',
      evidence: { kind: 'abnormal_submission_frequency', matching_submission_count: 10 },
    })

    const owner = await fixture({
      flagPolicy: { type: 'team-derived', key_version: 1 },
    })
    const offender = await addParticipant(owner)
    const stolenFlag = 'flag{derived-for-owner}'
    const incorrect = await repository.append(
      appendCommand(offender, stolenFlag, 'incorrect').command,
    )
    const correct = await repository.append(
      appendCommand(owner, stolenFlag, 'correct').command,
    )
    const foreign = await database.executor.query<{
      participation_id: string
      evidence: Record<string, unknown>
    }>(
      `SELECT participation_id, evidence
       FROM cheat_clues
       WHERE contest_id = $1 AND clue_type = 'foreign_team_flag'`,
      [owner.contestId],
    )
    expect(foreign.rows).toHaveLength(1)
    expect(foreign.rows[0]).toMatchObject({
      participation_id: offender.participationId,
      evidence: {
        kind: 'foreign_team_flag',
        incorrect_submission_id: incorrect.id,
        owner_submission_id: correct.id,
        participation_id: offender.participationId,
        owner_participation_id: owner.participationId,
      },
    })
    expect(JSON.stringify(foreign.rows[0]!.evidence)).not.toContain(stolenFlag)
  })

  it('applies the human review state machine idempotently and only writes immutable audit evidence', async () => {
    const input = await fixture()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await repository.append(appendCommand(input, 'flag{review-me}', 'incorrect').command)
    }
    const open = (await repository.listCheatClues(
      input.contestId,
      'open',
      undefined,
      20,
    )).items.find(clue => clue.clueType === 'repeated_incorrect_answer')!
    const reviewingCommand = {
      actorId: input.userId,
      contestId: input.contestId,
      clueId: open.id,
      status: 'reviewing' as const,
      note: null,
      requestId: randomUUID(),
      at,
    }
    const reviewing = await repository.reviewCheatClue(reviewingCommand)
    const replayed = await repository.reviewCheatClue(reviewingCommand)
    expect(reviewing).toMatchObject({ status: 'reviewing', reviewedBy: null, reviewedAt: null })
    expect(replayed).toEqual(reviewing)

    const confirmed = await repository.reviewCheatClue({
      ...reviewingCommand,
      status: 'confirmed',
      note: 'Confirmed after reviewing the evidence',
      requestId: randomUUID(),
    })
    expect(confirmed).toMatchObject({
      status: 'confirmed',
      reviewedBy: input.userId,
      reviewNote: 'Confirmed after reviewing the evidence',
      reviewedAt: at,
    })
    await expect(repository.reviewCheatClue({
      ...reviewingCommand,
      status: 'dismissed',
      note: 'Attempt to change a final conclusion',
      requestId: randomUUID(),
    })).rejects.toBeInstanceOf(CheatClueReviewConflictError)
    await expect(repository.reviewCheatClue({
      ...reviewingCommand,
      status: 'confirmed',
      note: 'Conflicting reuse of the first request',
    })).rejects.toBeInstanceOf(CheatClueRequestConflictError)

    const facts = await database.executor.query<{
      audit_count: string
      adjustment_count: string
      solve_count: string
      scoreboard_version: string | null
    }>(
      `SELECT
         (SELECT count(*)::text FROM audit_events
          WHERE target_type = 'cheat_clue' AND target_id = $2) AS audit_count,
         (SELECT count(*)::text FROM score_adjustments WHERE contest_id = $1) AS adjustment_count,
         (SELECT count(*)::text FROM solves WHERE contest_id = $1) AS solve_count,
         (SELECT version::text FROM scoreboard_versions WHERE contest_id = $1) AS scoreboard_version`,
      [input.contestId, open.id],
    )
    expect(facts.rows[0]).toEqual({
      audit_count: '2',
      adjustment_count: '0',
      solve_count: '0',
      scoreboard_version: null,
    })
  })

  it('paginates a management projection that never selects answer protection material', async () => {
    const input = await fixture()
    for (const [index, answer] of ['flag{first}', 'flag{second}', 'flag{third}'].entries()) {
      await repository.append(appendCommand(
        input,
        answer,
        'incorrect',
        randomUUID(),
        new Date(at.getTime() + index),
      ).command)
    }
    const first = await repository.listManaged(input.contestId, undefined, 2)
    expect(first.items).toHaveLength(2)
    expect(first).toMatchObject({ hasMore: true, nextCursor: expect.any(String) })
    expect(JSON.stringify(first)).not.toMatch(/answer|digest|ciphertext|flag\{/u)
    const second = await repository.listManaged(input.contestId, first.nextCursor!, 2)
    expect(second.items).toHaveLength(1)
    expect(second.hasMore).toBe(false)
    await expect(repository.listManaged(input.contestId, randomUUID(), 2)).rejects.toBeInstanceOf(
      SubmissionCursorInvalidError,
    )
  })

  it('replays the same PostgreSQL fact snapshot to identical current scores and ranking summaries', async () => {
    const firstTeam = await fixture({
      scoringPolicy: {
        type: 'decay-v1',
        initial_points: 500,
        minimum_points: 100,
        decay_solves: 10,
      },
    })
    const secondTeam = await addParticipant(firstTeam)
    await repository.append(appendCommand(firstTeam, 'flag{correct}', 'correct').command)
    await repository.append(appendCommand(secondTeam, 'flag{correct}', 'correct').command)
    await repository.recordScoreAdjustment(adjustmentCommand(
      firstTeam,
      -25,
      'Apply the reviewed replay fixture penalty',
    ))
    await database.executor.query(
      `UPDATE contests
       SET end_at = $2, practice_enabled = true, updated_at = $3
       WHERE id = $1`,
      [firstTeam.contestId, new Date(at.getTime() - 1), at],
    )
    await repository.append(appendCommand(firstTeam, 'flag{correct}', 'correct').command)

    const replayer = new ContestScoringReplayService(
      new PostgresScoringReplayRepository(database.executor),
    )
    const first = await replayer.replay(firstTeam.contestId)
    const second = await replayer.replay(firstTeam.contestId)
    expect(second).toEqual(first)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(first.challengeScores).toEqual([expect.objectContaining({
      challengeId: firstTeam.challengeId,
      officialSolveCount: 2,
      currentPoints: 461,
      firstSolve: expect.objectContaining({ participationId: firstTeam.participationId }),
    })])
    expect(first.participationScores).toEqual(expect.arrayContaining([
      expect.objectContaining({
        participationId: firstTeam.participationId,
        officialSolveCount: 1,
        solvePoints: 461,
        adjustmentPoints: -25,
        totalPoints: 436,
      }),
      expect.objectContaining({
        participationId: secondTeam.participationId,
        officialSolveCount: 1,
        solvePoints: 461,
        adjustmentPoints: 0,
        totalPoints: 461,
      }),
    ]))
    expect(first.rankingSummary.map(row => row.participationId)).toEqual([
      secondTeam.participationId,
      firstTeam.participationId,
    ])
  })
})
