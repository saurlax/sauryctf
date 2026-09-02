import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { PostgresTestClient as Client } from '../../test-support/postgres-database'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  FlagVerifier,
  staticFlagDigest,
  VersionedFlagKeyring,
} from '../../domains/challenges/flag-verifier'
import { ContestChallengeService } from '../../domains/challenges/contest-challenge-service'
import { ChallengeTemplateService } from '../../domains/challenges/service'
import { ContestService } from '../../domains/contests/service'
import { defaultAdministrator, IdentityService } from '../../domains/identity/service'
import type { SessionSubject } from '../../domains/identity/repository'
import type { PasswordHasher } from '../../domains/identity/password'
import { ParticipationService } from '../../domains/participations/service'
import { ScoreboardViewService } from '../../domains/scoreboards/view-service'
import { SubmissionService } from '../../domains/submissions/service'
import { ContestScoringReplayService } from '../../domains/submissions/scoring-replay'
import { TeamService } from '../../domains/teams/service'
import { WriteupService } from '../../domains/writeups/service'
import { AesGcmIdentityMailTokenProtector } from '../auth/identity-mail-token-protector'
import { identityTokenCodec } from '../auth/identity-token-codec'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { PostgresChallengeTemplateRepository } from '../db/challenge-template-repository'
import { PostgresContestChallengeRepository } from '../db/contest-challenge-repository'
import { PostgresContestRepository } from '../db/contest-repository'
import { PostgresIdentityRepository } from '../db/identity-repository'
import { runPostgresTestMigrations } from '../../test-support/postgres-database'
import { PostgresParticipationRepository } from '../db/participation-repository'
import { PostgresScoreboardViewRepository } from '../db/scoreboard-view-repository'
import { PostgresScoringReplayRepository } from '../db/scoring-replay-repository'
import { PostgresSubmissionRepository } from '../db/submission-repository'
import { PostgresTeamRepository } from '../db/team-repository'
import { PostgresWriteupRepository } from '../db/writeup-repository'
import { AesGcmSubmissionAnswerProtector } from '../security/submission-answer-protector'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`
const initialTime = new Date(Date.now() - 2_000)
const contestEnd = new Date(initialTime.getTime() + 5 * 60_000)
let currentTime = initialTime

const smokePasswordHasher: PasswordHasher = {
  async hash(password) {
    return `$scrypt$smoke$${scryptSync(password, 'sauryctf-jeopardy-smoke', 32).toString('hex')}`
  },
  async verify(passwordHash, password) {
    const expectedHex = passwordHash.split('$').at(-1)
    if (!expectedHex) return false
    const expected = Buffer.from(expectedHex, 'hex')
    const actual = scryptSync(password, 'sauryctf-jeopardy-smoke', expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  },
  needsRehash: passwordHash => !passwordHash.startsWith('$scrypt$smoke$'),
}

function quotedDatabaseName(): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) {
    throw new Error('Unexpected test database name')
  }
  return `"${databaseName}"`
}

function databaseUrl(source: string): string {
  const url = new URL(source)
  url.pathname = `/${databaseName}`
  return url.toString()
}

describeWithPostgres('fresh PostgreSQL Jeopardy smoke flow', () => {
  let admin: Client
  let database: PostgresTestDatabase
  let identityRepository: PostgresIdentityRepository
  let identity: IdentityService
  let teams: TeamService
  let participations: ParticipationService
  let contests: ContestService
  let challengeTemplates: ChallengeTemplateService
  let contestChallenges: ContestChallengeService
  let submissions: SubmissionService
  let scoreboards: ScoreboardViewService
  let writeups: WriteupService

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    database = createPostgresTestDatabase({
      connectionString: databaseUrl(adminConnectionString!),
      applicationName: 'sauryctf-jeopardy-smoke',
      maxConnections: 12,
    })
    await runPostgresTestMigrations(database)

    identityRepository = new PostgresIdentityRepository(database.executor)
    identity = new IdentityService(
      identityRepository,
      smokePasswordHasher,
      identityTokenCodec,
      () => currentTime,
      new AesGcmIdentityMailTokenProtector(
        'jeopardy-smoke-session-secret-that-is-at-least-32-characters',
      ),
    )
    teams = new TeamService(new PostgresTeamRepository(database.executor))
    participations = new ParticipationService(new PostgresParticipationRepository(database.executor))
    contests = new ContestService(new PostgresContestRepository(database.executor))
    challengeTemplates = new ChallengeTemplateService(
      new PostgresChallengeTemplateRepository(database.executor),
    )
    contestChallenges = new ContestChallengeService(
      new PostgresContestChallengeRepository(database.executor),
      () => currentTime,
    )
    submissions = new SubmissionService(
      new PostgresSubmissionRepository(database.executor),
      new FlagVerifier(new VersionedFlagKeyring({})),
      { consume: async () => ({ allowed: true, retryAfterMs: 0 }) },
      new AesGcmSubmissionAnswerProtector(Buffer.alloc(32, 11)),
      () => currentTime,
    )
    scoreboards = new ScoreboardViewService(
      new PostgresScoreboardViewRepository(database.executor),
      new ContestScoringReplayService(new PostgresScoringReplayRepository(database.executor)),
      undefined,
      () => currentTime,
    )
    writeups = new WriteupService(
      new PostgresWriteupRepository(database.executor),
      { build: async () => new Uint8Array() },
      () => currentTime,
    )
  }, 30_000)

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

  it('completes bootstrap, registration, team, contest, scoring, practice, and Writeup', async () => {
    const bootstrap = await identity.bootstrapDefaultAdministrator()
    expect(bootstrap).toMatchObject({ created: true, identity: { sessionVersion: 1 } })
    const initialAdminLogin = await identity.login({
      identifier: defaultAdministrator.username,
      password: defaultAdministrator.password,
    })

    const changedPassword = await identity.changePassword(
      initialAdminLogin.userId,
      defaultAdministrator.password,
      'smoke administrator replacement password',
    )
    expect(changedPassword.sessionVersion).toBe(2)
    await identity.changeEmail(initialAdminLogin.userId, 'operator-smoke@example.test')
    const adminVerification = await identity.requestEmailVerification(initialAdminLogin.userId)
    await identity.verifyEmail(adminVerification.token)
    const adminActor = await requireSubject(initialAdminLogin.userId)
    expect(adminActor).toMatchObject({
      username: defaultAdministrator.username,
      email: 'operator-smoke@example.test',
      emailVerified: true,
      role: 'admin',
      sessionVersion: 3,
      mustChangePassword: false,
    })
    await expect(identity.login({
      identifier: defaultAdministrator.username,
      password: defaultAdministrator.password,
    })).rejects.toMatchObject({ code: 'identity.invalid_credentials' })
    await expect(identity.login({
      identifier: defaultAdministrator.username,
      password: 'smoke administrator replacement password',
    })).resolves.toMatchObject({ userId: adminActor.userId, sessionVersion: 3 })

    const registered = await identity.register({
      username: 'SmokePlayer',
      email: 'smoke-player@example.test',
      password: 'smoke player password',
    })
    const verification = await identity.requestEmailVerification(registered.userId)
    await identity.verifyEmail(verification.token)
    const playerActor = await requireSubject(registered.userId)
    expect(playerActor).toMatchObject({ emailVerified: true, role: 'user' })

    const team = await teams.create(playerActor, 'Smoke Team')
    expect(team.team).toMatchObject({
      name: 'Smoke Team',
      members: [{ userId: playerActor.userId, role: 'captain' }],
    })

    const contest = await contests.createDraft(adminActor, {
      requestId: randomUUID(),
      title: 'Jeopardy Smoke Contest',
      slug: `jeopardy-smoke-${randomUUID()}`,
      description: 'Fresh PostgreSQL release smoke contest',
      registrationStrategy: 'auto_accept',
      startAt: new Date(initialTime.getTime() - 60_000),
      endAt: contestEnd,
      practiceEnabled: true,
      writeupRequired: true,
      writeupDeadlineAt: new Date(contestEnd.getTime() + 10 * 60_000),
      minTeamSize: 1,
      maxTeamSize: 5,
    })
    const flag = 'flag{fresh-postgresql-smoke}'
    const template = await challengeTemplates.create(adminActor, {
      requestId: randomUUID(),
      name: 'Jeopardy Smoke Template',
      slug: `jeopardy-smoke-template-${randomUUID()}`,
      title: 'Fresh PostgreSQL',
      category: 'web',
      description: 'Submit the release smoke flag.',
      flagFormat: 'flag{...}',
      flagPolicy: { type: 'static', digest: staticFlagDigest(flag) },
      scoringPolicy: { type: 'fixed-v1', points: 500 },
      instancePolicy: { type: 'none' },
      assets: [],
      hints: [],
    })
    const challenge = await contestChallenges.mount(adminActor, {
      requestId: randomUUID(),
      contestId: contest.id,
      templateVersionId: template.challengeVersion.id,
      enabled: true,
      publishAt: null,
      closeAt: null,
      submissionLimit: 10,
      sortOrder: 0,
    })
    await expect(contests.checkPublication(adminActor, contest.id)).resolves.toMatchObject({
      ready: true,
      issues: [],
    })
    await expect(contests.publish(adminActor, {
      requestId: randomUUID(),
      contestId: contest.id,
      reason: 'Release smoke publication',
    })).resolves.toMatchObject({ publicationStatus: 'published', phase: 'running' })

    const participation = await participations.register(playerActor, contest.id)
    expect(participation).toMatchObject({ status: 'accepted', teamId: team.team.id })
    await expect(contestChallenges.readForPlayer(
      playerActor,
      contest.id,
      challenge.id,
    )).resolves.toMatchObject({
      state: 'open',
      content: { description: 'Submit the release smoke flag.' },
    })

    await expect(submissions.verifyFlag(playerActor, {
      contestId: contest.id,
      challengeId: challenge.id,
      submittedFlag: flag,
      requestId: randomUUID(),
    })).resolves.toEqual({ correct: true, result: 'correct', mode: 'official' })
    const officialBoard = await scoreboards.read({
      contestId: contest.id,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'overall' },
    })
    expect(officialBoard).toMatchObject({
      state: 'live',
      version: 1,
      board: {
        challenges: [{ challengeId: challenge.id, officialSolveCount: 1, currentPoints: 500 }],
        rows: [{
          rank: 1,
          participationId: participation.id,
          teamId: team.team.id,
          teamName: 'Smoke Team',
          totalPoints: 500,
          officialSolveCount: 1,
        }],
      },
    })

    const savedWriteup = await writeups.saveOwn(playerActor, {
      contestId: contest.id,
      expectedVersion: 0,
      body: '# Fresh PostgreSQL\n\nRelease smoke solution.',
      attachmentIds: [],
    })
    const submittedWriteup = await writeups.submitOwn(playerActor, {
      contestId: contest.id,
      expectedVersion: savedWriteup.version,
    })
    const approvedWriteup = await writeups.review(adminActor, {
      requestId: randomUUID(),
      contestId: contest.id,
      writeupId: submittedWriteup.id,
      expectedVersion: submittedWriteup.version,
      decision: 'approved',
      note: 'Release smoke review passed',
    })
    expect(approvedWriteup).toMatchObject({ status: 'approved', submittedVersion: 1 })

    currentTime = new Date(contestEnd.getTime() + 1_000)
    await expect(submissions.verifyFlag(playerActor, {
      contestId: contest.id,
      challengeId: challenge.id,
      submittedFlag: flag,
      requestId: randomUUID(),
    })).resolves.toEqual({ correct: true, result: 'correct', mode: 'practice' })
    const settledBoard = await scoreboards.read({
      contestId: contest.id,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'overall' },
    })
    expect(settledBoard).toMatchObject({
      state: 'settled',
      version: 1,
      board: { rows: [{ totalPoints: 500, officialSolveCount: 1 }] },
    })

    const facts = await database.executor.query<{
      official_solves: number
      practice_solves: number
      scoreboard_version: number
      writeup_status: string
    }>(`
      SELECT
        (SELECT count(*)::int FROM solves WHERE contest_id = $1 AND mode = 'official') AS official_solves,
        (SELECT count(*)::int FROM solves WHERE contest_id = $1 AND mode = 'practice') AS practice_solves,
        (SELECT version::int FROM scoreboard_versions WHERE contest_id = $1) AS scoreboard_version,
        (SELECT status::text FROM writeups WHERE contest_id = $1) AS writeup_status`,
    [contest.id])
    expect(facts.rows).toEqual([{
      official_solves: 1,
      practice_solves: 1,
      scoreboard_version: 1,
      writeup_status: 'approved',
    }])
  }, 30_000)

  async function requireSubject(userId: string): Promise<SessionSubject> {
    const subject = await identityRepository.findSessionSubject(userId)
    if (!subject) throw new Error(`Missing smoke identity ${userId}`)
    return subject
  }
})
