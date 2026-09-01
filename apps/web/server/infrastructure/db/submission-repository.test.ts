import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { staticFlagDigest } from '../../domains/challenges/flag-verifier'
import {
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
import { createDatabaseClient, type DatabaseClient } from './client'
import { runMigrations } from './migrate'
import { PostgresSubmissionRepository } from './submission-repository'
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
  let database: DatabaseClient
  let repository: PostgresSubmissionRepository
  const answers = new AesGcmSubmissionAnswerProtector(Buffer.alloc(32, 7))

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 8 })
    await runMigrations(database)
    repository = new PostgresSubmissionRepository(database.pool)
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

  async function fixture(options: {
    membership?: boolean
    participationStatus?: 'pending' | 'accepted' | 'rejected' | 'withdrawn'
    startAt?: Date
    endAt?: Date
    enabled?: boolean
    publishAt?: Date | null
    closeAt?: Date | null
    submissionLimit?: number | null
  } = {}) {
    const suffix = randomUUID()
    const user = await database.pool.query<{ id: string }>(
      `INSERT INTO users
         (username, username_normalized, email, email_normalized, email_verified_at)
       VALUES ($1, $2, $3, $3, $4)
       RETURNING id`,
      [`Player-${suffix}`, `player-${suffix}`, `player-${suffix}@example.test`, at],
    )
    const userId = user.rows[0]!.id
    const connection = await database.pool.connect()
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
    const contest = await database.pool.query<{ id: string }>(
      `INSERT INTO contests
         (title, slug, start_at, end_at, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        `Contest-${suffix}`,
        `contest-${suffix}`,
        options.startAt ?? new Date(at.getTime() - 60_000),
        options.endAt ?? new Date(at.getTime() + 60_000),
        userId,
      ],
    )
    const contestId = contest.rows[0]!.id
    const participationStatus = options.participationStatus ?? 'accepted'
    const reviewed = ['accepted', 'rejected'].includes(participationStatus)
    const withdrawn = participationStatus === 'withdrawn'
    const participation = await database.pool.query<{ id: string }>(
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
    const challenge = await createPublishableChallenge(database.pool, contestId, userId, {
      enabled: options.enabled,
      publishAt: options.publishAt,
      closeAt: options.closeAt,
      submissionLimit: options.submissionLimit,
      flagPolicy: { type: 'static', digest: staticFlagDigest('flag{correct}') },
    })
    await database.pool.query(
      `UPDATE contests
       SET publication_status = 'published', published_at = $2, updated_at = $2
       WHERE id = $1`,
      [contestId, new Date(at.getTime() - 120_000)],
    )
    return {
      userId,
      teamId,
      contestId,
      challengeId: challenge.challengeId,
      participationId: participation.rows[0]!.id,
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

  it('returns only the authoritative context needed after every eligibility check passes', async () => {
    const input = await fixture()
    await expect(admit(input)).resolves.toEqual({
      contestId: input.contestId,
      challengeId: input.challengeId,
      participationId: input.participationId,
      teamId: input.teamId,
      flagFormat: 'flag{...}',
      flagPolicy: { type: 'static', digest: staticFlagDigest('flag{correct}') },
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
    await database.pool.query(
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

    const persisted = await database.pool.query<{
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
    await expect(database.pool.query(
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
    const count = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM submissions WHERE request_id = $1',
      [protectedInput.command.requestId],
    )
    expect(count.rows[0]!.count).toBe('1')
    await expect(repository.append({
      ...protectedInput.command,
      result: 'correct',
    })).rejects.toBeInstanceOf(SubmissionRequestConflictError)
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
})
