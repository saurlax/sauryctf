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
      flagFormat: 'flag{...}',
      flagPolicy: { type: 'static' as const, digest: 'a'.repeat(64) },
    })),
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
        flagFormat: 'flag{...}',
        flagPolicy: { type: 'static' as const, digest: 'a'.repeat(64) },
      }
    })
    const limiter = allowedLimiter(input => order.push(`${input.scope}:${input.action}`))
    const verifier = {
      verify: vi.fn(() => {
        order.push('verify')
        return { correct: true }
      }),
    }
    const service = new SubmissionService(repository, verifier, limiter, () => at)

    await expect(service.verifyFlag(actor, {
      contestId,
      challengeId,
      submittedFlag: 'flag{correct}',
    })).resolves.toEqual({ correct: true })

    expect(order).toEqual([
      'user:submission.flag',
      'user:submission.flag.challenge',
      'admission',
      'team:submission.flag',
      'team:submission.flag.challenge',
      'challenge:submission.flag',
      'verify',
    ])
    expect(repository.admit).toHaveBeenCalledWith({ userId, contestId, challengeId, at })
  })

  it.each([
    [new SubmissionTeamRequiredError(), 'team.membership_required'],
    [new SubmissionParticipationNotAcceptedError(), 'participation.not_accepted'],
    [new SubmissionContestNotRunningError(), 'contest.not_running'],
    [new SubmissionChallengeUnavailableError(), 'challenge.not_found'],
    [new SubmissionChallengeClosedError(), 'challenge.submission_closed'],
    [new SubmissionLimitReachedError(), 'challenge.submission_limit_reached'],
  ] as const)('does not evaluate either a correct or incorrect Flag after %s', async (failure, code) => {
    const repository: SubmissionRepository = { admit: vi.fn(async () => { throw failure }) }
    const verifier = { verify: vi.fn(() => ({ correct: true })) }
    const service = new SubmissionService(repository, verifier, allowedLimiter(), () => at)

    for (const submittedFlag of ['flag{correct}', 'flag{wrong}']) {
      await expect(service.verifyFlag(actor, {
        contestId,
        challengeId,
        submittedFlag,
      })).rejects.toMatchObject({ code })
    }
    expect(verifier.verify).not.toHaveBeenCalled()
  })

  it('blocks an unverified identity before repository access or Flag validation', async () => {
    const repository = admissionRepository()
    const verifier = { verify: vi.fn(() => ({ correct: true })) }
    const service = new SubmissionService(repository, verifier, allowedLimiter(), () => at)

    await expect(service.verifyFlag({ ...actor, emailVerified: false }, {
      contestId,
      challengeId,
      submittedFlag: 'flag{correct}',
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
    const service = new SubmissionService(repository, verifier, limiter, () => at)

    await expect(service.verifyFlag(actor, {
      contestId,
      challengeId,
      submittedFlag: 'flag{correct}',
    })).rejects.toEqual(expect.objectContaining<Partial<SubmissionServiceError>>({
      code: 'security.rate_limited',
      retryAfterMs: 42_000,
    }))
    expect(repository.admit).toHaveBeenCalledOnce()
    expect(verifier.verify).not.toHaveBeenCalled()
  })
})
