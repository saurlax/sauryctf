import { createApp, eventHandler, setResponseStatus, toWebHandler } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import { DisabledHumanVerificationProvider } from '../../domains/identity/human-verification'
import type { SessionSubject } from '../../domains/identity/repository'
import { InvalidIdentitySessionError } from '../../domains/identity/session'
import { SubmissionServiceError } from '../../domains/submissions/service'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from '../security/rate-limit'
import {
  handleListManagedSubmissions,
  handleRecordScoreAdjustment,
  handleSubmitFlag,
  type SubmissionHttpDependencies,
} from './submission-http'

const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f80'
const userId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f81'
const contestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f82'
const challengeId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f83'
const session: AuthSessionData = {
  user_id: userId,
  session_version: 1,
  logged_in_at: '2026-09-01T08:00:00.000Z',
}
const player: SessionSubject = {
  userId,
  username: 'Player',
  email: 'player@example.test',
  emailVerified: true,
  status: 'active',
  role: 'user',
  sessionVersion: 1,
  mustChangePassword: false,
}
const organizer: SessionSubject = { ...player, role: 'organizer' }

function dependencies(options: {
  subject?: SessionSubject
  sessionFailure?: Error
  serviceFailure?: SubmissionServiceError
  result?: 'correct' | 'incorrect' | 'already_solved'
  mode?: 'official' | 'practice'
  rateLimits?: MemoryRateLimitStore
  managedItems?: Awaited<ReturnType<SubmissionHttpDependencies['submissions']['listManaged']>>['items']
} = {}): SubmissionHttpDependencies {
  const clear = vi.fn()
  return {
    identity: {
      identity: {} as SubmissionHttpDependencies['identity']['identity'],
      sessions: {
        validate: vi.fn(async () => {
          if (options.sessionFailure) throw options.sessionFailure
          return options.subject ?? player
        }),
      },
      humanVerification: new DisabledHumanVerificationProvider(),
      rateLimits: options.rateLimits ?? new MemoryRateLimitStore(),
      browserSession: { read: vi.fn(async () => session), replace: vi.fn(), clear },
    },
    submissions: {
      verifyFlag: vi.fn(async () => {
        if (options.serviceFailure) throw options.serviceFailure
        const result = options.result ?? 'correct'
        return { correct: result !== 'incorrect', result, mode: options.mode ?? 'official' }
      }),
      listManaged: vi.fn(async () => ({
        items: options.managedItems ?? [],
        nextCursor: null,
        hasMore: false,
      })),
      recordScoreAdjustment: vi.fn(async (_actor, input) => ({
        id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f86',
        contestId: input.contestId,
        participationId: input.participationId,
        pointsDelta: input.pointsDelta,
        reason: input.reason,
        createdBy: userId,
        requestId: input.requestId,
        createdAt: new Date('2026-09-01T08:02:00.000Z'),
      })),
    },
  }
}

async function invokeManaged(deps: SubmissionHttpDependencies) {
  const app = createApp()
  app.use(eventHandler(async (event) => {
    event.context.requestId = requestId
    try {
      return await handleListManagedSubmissions(event, contestId, deps)
    }
    catch (error) {
      const response = normalizeApiError(error, requestId)
      setResponseStatus(event, response.statusCode)
      return response.body
    }
  }))
  return toWebHandler(app)(new Request(
    `https://ctf.example.test/api/admin/contests/${contestId}/submissions?limit=20`,
  ))
}

async function invoke(deps: SubmissionHttpDependencies, flag = 'flag{correct}') {
  const app = createApp()
  app.use(eventHandler(async (event) => {
    event.context.requestId = requestId
    try {
      return await handleSubmitFlag(event, contestId, challengeId, deps)
    }
    catch (error) {
      const response = normalizeApiError(error, requestId)
      setResponseStatus(event, response.statusCode)
      return response.body
    }
  }))
  return toWebHandler(app)(new Request(
    `https://ctf.example.test/api/contests/${contestId}/challenges/${challengeId}/submissions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flag }),
    },
  ))
}

async function invokeAdjustment(
  deps: SubmissionHttpDependencies,
  body: Record<string, unknown> = {
    participation_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f85',
    points_delta: -25,
    reason: 'Apply the reviewed rule penalty',
    confirm: true,
  },
) {
  const app = createApp()
  app.use(eventHandler(async (event) => {
    event.context.requestId = requestId
    try {
      return await handleRecordScoreAdjustment(event, contestId, deps)
    }
    catch (error) {
      const response = normalizeApiError(error, requestId)
      setResponseStatus(event, response.statusCode)
      return response.body
    }
  }))
  return toWebHandler(app)(new Request(
    `https://ctf.example.test/api/admin/contests/${contestId}/score-adjustments`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  ))
}

describe('Flag submission HTTP admission', () => {
  it.each([
    'correct',
    'incorrect',
    'already_solved',
  ] as const)('returns only the redacted %s verdict after successful admission', async (result) => {
    const deps = dependencies({ result })
    const response = await invoke(deps)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ result, mode: 'official' })
    expect(deps.submissions.verifyFlag).toHaveBeenCalledWith(player, {
      contestId,
      challengeId,
      submittedFlag: 'flag{correct}',
      requestId,
    })
  })

  it('returns the server-derived practice mode without accepting it as client input', async () => {
    const deps = dependencies({ mode: 'practice' })
    const response = await invoke(deps)
    await expect(response.json()).resolves.toEqual({ result: 'correct', mode: 'practice' })
  })

  it('rejects an unverified email before the submission service sees the Flag', async () => {
    const deps = dependencies({ subject: { ...player, emailVerified: false } })
    const response = await invoke(deps)
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'identity.email_verification_required' },
    })
    expect(deps.submissions.verifyFlag).not.toHaveBeenCalled()
  })

  it('clears and rejects a banned identity session before Flag validation', async () => {
    const deps = dependencies({ sessionFailure: new InvalidIdentitySessionError() })
    const response = await invoke(deps)
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'identity.session_invalid' } })
    expect(deps.identity.browserSession.clear).toHaveBeenCalledOnce()
    expect(deps.submissions.verifyFlag).not.toHaveBeenCalled()
  })

  it.each([
    'participation.not_accepted',
    'contest.not_running',
    'challenge.submission_closed',
    'challenge.submission_limit_reached',
  ] as const)('returns the same %s response for correct and incorrect candidates', async (code) => {
    const deps = dependencies({ serviceFailure: new SubmissionServiceError(code) })
    const correct = await invoke(deps, 'flag{correct}')
    const wrong = await invoke(deps, 'flag{wrong}')
    const correctBody = await correct.json()
    const wrongBody = await wrong.json()
    expect(correct.status).toBe(wrong.status)
    expect(correctBody).toEqual(wrongBody)
    expect(JSON.stringify(correctBody)).not.toMatch(/flag\{|"result"|"correct"|"incorrect"/u)
  })

  it('limits one source network for a specific challenge before session or service work', async () => {
    const deps = dependencies({ rateLimits: new MemoryRateLimitStore() })
    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect((await invoke(deps)).status).toBe(200)
    }
    const rejected = await invoke(deps)
    expect(rejected.status).toBe(429)
    expect(rejected.headers.get('retry-after')).toBeTruthy()
    expect(deps.submissions.verifyFlag).toHaveBeenCalledTimes(30)
  })

  it('returns a fixed mask and no digest, ciphertext, or answer from ordinary management reads', async () => {
    const deps = dependencies({
      subject: organizer,
      managedItems: [{
        id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f84',
        contestId,
        challengeId,
        participationId: '018f47a2-4ef8-7e2c-9c24-6d68b7451f85',
        userId,
        mode: 'official',
        result: 'incorrect',
        submittedAt: new Date('2026-09-01T08:01:00.000Z'),
      }],
    })
    const response = await invokeManaged(deps)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ items: [{ answer_masked: '••••••••' }] })
    expect(JSON.stringify(body)).not.toMatch(/digest|ciphertext|submitted_flag|flag\{/u)
  })

  it('requires the global judge capability for management submission reads', async () => {
    const deps = dependencies({ subject: player })
    const response = await invokeManaged(deps)
    expect(response.status).toBe(403)
    expect(deps.submissions.listManaged).not.toHaveBeenCalled()
  })

  it('records a confirmed score adjustment through the organizer judge capability', async () => {
    const deps = dependencies({ subject: organizer })
    const response = await invokeAdjustment(deps)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      adjustment: {
        contest_id: contestId,
        points_delta: -25,
        reason: 'Apply the reviewed rule penalty',
        request_id: requestId,
      },
    })
    expect(deps.submissions.recordScoreAdjustment).toHaveBeenCalledWith(organizer, {
      contestId,
      participationId: '018f47a2-4ef8-7e2c-9c24-6d68b7451f85',
      pointsDelta: -25,
      reason: 'Apply the reviewed rule penalty',
      confirmed: true,
      requestId,
    })
  })

  it('rejects an unconfirmed score adjustment and a player before domain mutation', async () => {
    const organizerDependencies = dependencies({ subject: organizer })
    const unconfirmed = await invokeAdjustment(organizerDependencies, {
      participation_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f85',
      points_delta: 25,
      reason: 'Apply the reviewed score correction',
      confirm: false,
    })
    expect(unconfirmed.status).toBe(400)
    expect(organizerDependencies.submissions.recordScoreAdjustment).not.toHaveBeenCalled()

    const playerDependencies = dependencies({ subject: player })
    const forbidden = await invokeAdjustment(playerDependencies)
    expect(forbidden.status).toBe(403)
    expect(playerDependencies.submissions.recordScoreAdjustment).not.toHaveBeenCalled()
  })
})
