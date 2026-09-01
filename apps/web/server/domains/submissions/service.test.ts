import { describe, expect, it, vi } from 'vitest'
import { IdentityCapabilityError } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'
import {
  SubmissionChallengeClosedError,
  SubmissionChallengeUnavailableError,
  SubmissionContestNotRunningError,
  SubmissionLimitReachedError,
  SubmissionParticipationNotAcceptedError,
  SubmissionTeamRequiredError,
  type SubmissionRepository,
} from './repository'
import {
  SubmissionService,
  SubmissionServiceError,
  type SubmissionRateLimiter,
} from './service'

const userId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f70'
const teamId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f71'
const contestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f72'
const challengeId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f73'
const participationId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f74'
const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f75'
const at = new Date('2026-09-01T08:00:00.000Z')

const actor: SessionSubject = {
  userId,
  username: 'Player',
  email: 'player@example.test',
  emailVerified: true,
  status: 'active',
  role: 'user',
  sessionVersion: 1,
  mustChangePassword: false,
}

function allowedLimiter(onConsume?: (input: Parameters<SubmissionRateLimiter['consume']>[0]) => void) {
  return {
    consume: vi.fn(async (input: Parameters<SubmissionRateLimiter['consume']>[0]) => {
      onConsume?.(input)
      return { allowed: true, retryAfterMs: 0 }
    }),
  }
}

function admissionRepository() {
  return {
    admit: vi.fn(async () => ({
      contestId,
      challengeId,
      participationId,
      teamId,
      teamName: 'Blue Team',
      flagFormat: 'flag{...}',
      flagPolicy: { type: 'static' as const, digest: 'a'.repeat(64) },
      scoringPolicy: { type: 'fixed-v1' as const, points: 500 },
      mode: 'official' as const,
    })),
    append: vi.fn(async () => ({
      id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f76',
      contestId,
      challengeId,
      participationId,
      userId,
      mode: 'official' as const,
      result: 'correct' as const,
      submittedAt: at,
    })),
    listManaged: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
    recordScoreAdjustment: vi.fn(async input => ({
      id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f77',
      contestId: input.contestId,
      participationId: input.participationId,
      pointsDelta: input.pointsDelta,
      reason: input.reason,
      createdBy: input.actorId,
      requestId: input.requestId,
      createdAt: input.at,
    })),
  }
}

function answerProtector(onProtect?: () => void) {
  return {
    protect: vi.fn(() => {
      onProtect?.()
      return { digest: Buffer.alloc(32, 1), ciphertext: Buffer.alloc(33, 2) }
    }),
  }
}

describe('submission eligibility pipeline', () => {
  it('applies user, team, and challenge limits before invoking the Flag verifier', async () => {
    const order: string[] = []
    const repository = admissionRepository()
    repository.admit.mockImplementation(async () => {
      order.push('admission')
      return {
        contestId,
        challengeId,
        participationId,
        teamId,
        teamName: 'Blue Team',
        flagFormat: 'flag{...}',
        flagPolicy: { type: 'static' as const, digest: 'a'.repeat(64) },
        scoringPolicy: { type: 'fixed-v1' as const, points: 500 },
        mode: 'official' as const,
      }
    })
    const limiter = allowedLimiter(input => order.push(`${input.scope}:${input.action}`))
    const verifier = {
      verify: vi.fn(() => {
        order.push('verify')
        return { correct: true }
      }),
    }
    repository.append.mockImplementation(async () => {
      order.push('append')
      return {
        id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f76',
        contestId,
        challengeId,
        participationId,
        userId,
        mode: 'official',
        result: 'correct',
        submittedAt: at,
      }
    })
    const answers = answerProtector(() => order.push('protect'))
    const service = new SubmissionService(repository, verifier, limiter, answers, () => at)

    await expect(service.verifyFlag(actor, {
      contestId,
      challengeId,
      submittedFlag: 'flag{correct}',
      requestId,
    })).resolves.toEqual({ correct: true, result: 'correct', mode: 'official' })

    expect(order).toEqual([
      'user:submission.flag',
      'user:submission.flag.challenge',
      'admission',
      'team:submission.flag',
      'team:submission.flag.challenge',
      'challenge:submission.flag',
      'verify',
      'protect',
      'append',
    ])
    expect(repository.admit).toHaveBeenCalledWith({ userId, contestId, challengeId, at })
    expect(repository.append).toHaveBeenCalledWith(expect.objectContaining({
      userId,
      contestId,
      challengeId,
      requestId,
      result: 'correct',
      answerDigest: Buffer.alloc(32, 1),
      answerCiphertext: Buffer.alloc(33, 2),
    }))
  })

  it.each([
    [new SubmissionTeamRequiredError(), 'team.membership_required'],
    [new SubmissionParticipationNotAcceptedError(), 'participation.not_accepted'],
    [new SubmissionContestNotRunningError(), 'contest.not_running'],
    [new SubmissionChallengeUnavailableError(), 'challenge.not_found'],
    [new SubmissionChallengeClosedError(), 'challenge.submission_closed'],
    [new SubmissionLimitReachedError(), 'challenge.submission_limit_reached'],
  ] as const)('does not evaluate either a correct or incorrect Flag after %s', async (failure, code) => {
    const repository: SubmissionRepository = {
      admit: vi.fn(async () => { throw failure }),
      append: vi.fn(),
      listManaged: vi.fn(),
      recordScoreAdjustment: vi.fn(),
    }
    const verifier = { verify: vi.fn(() => ({ correct: true })) }
    const service = new SubmissionService(repository, verifier, allowedLimiter(), answerProtector(), () => at)

    for (const submittedFlag of ['flag{correct}', 'flag{wrong}']) {
      await expect(service.verifyFlag(actor, {
        contestId,
        challengeId,
        submittedFlag,
        requestId,
      })).rejects.toMatchObject({ code })
    }
    expect(verifier.verify).not.toHaveBeenCalled()
  })

  it('blocks an unverified identity before repository access or Flag validation', async () => {
    const repository = admissionRepository()
    const verifier = { verify: vi.fn(() => ({ correct: true })) }
    const service = new SubmissionService(repository, verifier, allowedLimiter(), answerProtector(), () => at)

    await expect(service.verifyFlag({ ...actor, emailVerified: false }, {
      contestId,
      challengeId,
      submittedFlag: 'flag{correct}',
      requestId,
    })).rejects.toBeInstanceOf(IdentityCapabilityError)
    expect(repository.admit).not.toHaveBeenCalled()
    expect(verifier.verify).not.toHaveBeenCalled()
  })

  it('stops at the first exhausted bucket and preserves retry timing without validation', async () => {
    let attempt = 0
    const limiter: SubmissionRateLimiter = {
      consume: vi.fn(async () => {
        attempt += 1
        return attempt === 4
          ? { allowed: false, retryAfterMs: 42_000 }
          : { allowed: true, retryAfterMs: 0 }
      }),
    }
    const repository = admissionRepository()
    const verifier = { verify: vi.fn(() => ({ correct: true })) }
    const service = new SubmissionService(repository, verifier, limiter, answerProtector(), () => at)

    await expect(service.verifyFlag(actor, {
      contestId,
      challengeId,
      submittedFlag: 'flag{correct}',
      requestId,
    })).rejects.toEqual(expect.objectContaining<Partial<SubmissionServiceError>>({
      code: 'security.rate_limited',
      retryAfterMs: 42_000,
    }))
    expect(repository.admit).toHaveBeenCalledOnce()
    expect(verifier.verify).not.toHaveBeenCalled()
  })
})

describe('score adjustment authorization', () => {
  it('allows a verified organizer to record a confirmed bounded adjustment with a reason', async () => {
    const repository = admissionRepository()
    const service = new SubmissionService(
      repository,
      { verify: vi.fn() },
      allowedLimiter(),
      answerProtector(),
      () => at,
    )

    await expect(service.recordScoreAdjustment({ ...actor, role: 'organizer' }, {
      contestId,
      participationId,
      pointsDelta: -25,
      reason: '  Apply the reviewed rule penalty  ',
      confirmed: true,
      requestId,
    })).resolves.toMatchObject({ pointsDelta: -25, reason: 'Apply the reviewed rule penalty' })
    expect(repository.recordScoreAdjustment).toHaveBeenCalledWith({
      actorId: userId,
      contestId,
      participationId,
      pointsDelta: -25,
      reason: 'Apply the reviewed rule penalty',
      requestId,
      at,
    })
  })

  it('rejects players, missing confirmation, invalid points, and short reasons before persistence', async () => {
    const repository = admissionRepository()
    const service = new SubmissionService(
      repository,
      { verify: vi.fn() },
      allowedLimiter(),
      answerProtector(),
      () => at,
    )
    const input = {
      contestId,
      participationId,
      pointsDelta: 25,
      reason: 'Reviewed score correction',
      confirmed: true,
      requestId,
    }

    await expect(service.recordScoreAdjustment(actor, input)).rejects.toBeInstanceOf(IdentityCapabilityError)
    await expect(service.recordScoreAdjustment(
      { ...actor, role: 'organizer' },
      { ...input, confirmed: false },
    )).rejects.toMatchObject({ code: 'score.adjustment_confirmation_required' })
    await expect(service.recordScoreAdjustment(
      { ...actor, role: 'organizer' },
      { ...input, pointsDelta: 0 },
    )).rejects.toMatchObject({ code: 'score.adjustment_invalid' })
    await expect(service.recordScoreAdjustment(
      { ...actor, role: 'organizer' },
      { ...input, reason: 'too short' },
    )).rejects.toMatchObject({ code: 'score.adjustment_reason_required' })
    expect(repository.recordScoreAdjustment).not.toHaveBeenCalled()
  })
})
