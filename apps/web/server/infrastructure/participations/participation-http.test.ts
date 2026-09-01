import {
  createApp,
  eventHandler,
  setResponseStatus,
  toWebHandler,
  type H3Event,
} from 'h3'
import { describe, expect, it, vi } from 'vitest'
import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import type { SessionSubject } from '../../domains/identity/repository'
import { DisabledHumanVerificationProvider } from '../../domains/identity/human-verification'
import { ParticipationServiceError } from '../../domains/participations/service'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from '../security/rate-limit'
import {
  handleCurrentParticipation,
  handleListParticipations,
  handleRegisterParticipation,
  handleReviewParticipation,
  type ParticipationHttpDependencies,
} from './participation-http'

const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c'
const userId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2d'
const contestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2e'
const participationId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2f'
const teamId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f30'
const session: AuthSessionData = {
  user_id: userId,
  session_version: 1,
  logged_in_at: '2026-09-01T07:08:09.123Z',
}
const verifiedSubject: SessionSubject = {
  userId,
  username: 'Player',
  email: 'player@example.test',
  emailVerified: true,
  status: 'active',
  role: 'user',
  sessionVersion: 1,
  mustChangePassword: false,
}
const participation = {
  id: participationId,
  contestId,
  teamId,
  teamName: 'Blue Team',
  divisionId: null,
  divisionName: null,
  status: 'pending' as const,
  registeredAt: new Date('2026-09-01T07:10:00.000Z'),
  reviewedAt: null,
  reviewReason: null,
  withdrawnAt: null,
  version: 1,
}

type ParticipationHandler = (
  event: H3Event,
  dependencies: ParticipationHttpDependencies,
) => Promise<unknown>

function createDependencies(
  subject: SessionSubject = verifiedSubject,
  overrides: Partial<ParticipationHttpDependencies['participations']> = {},
): ParticipationHttpDependencies {
  return {
    identity: {
      identity: {} as ParticipationHttpDependencies['identity']['identity'],
      sessions: { validate: vi.fn(async () => subject) },
      humanVerification: new DisabledHumanVerificationProvider(),
      rateLimits: new MemoryRateLimitStore(),
      browserSession: {
        read: vi.fn(async () => session),
        replace: vi.fn(async () => undefined),
        clear: vi.fn(async () => undefined),
      },
    },
    participations: {
      current: vi.fn(async () => ({
        team: { id: teamId, name: 'Blue Team', role: 'captain' as const },
        participation,
      })),
      register: vi.fn(async () => participation),
      withdraw: vi.fn(async () => ({ ...participation, status: 'withdrawn' as const })),
      review: vi.fn(async () => ({ ...participation, status: 'accepted' as const })),
      assignDivision: vi.fn(async () => participation),
      list: vi.fn(async () => ({ items: [participation], nextCursor: null, hasMore: false })),
      ...overrides,
    },
  }
}

async function invoke(
  handler: ParticipationHandler,
  dependencies: ParticipationHttpDependencies,
  options: { method?: string, body?: unknown, query?: string } = {},
): Promise<Response> {
  const app = createApp()
  app.use(eventHandler(async (event) => {
    event.context.requestId = requestId
    try {
      return await handler(event, dependencies)
    }
    catch (error) {
      const response = normalizeApiError(error, requestId)
      setResponseStatus(event, response.statusCode)
      return response.body
    }
  }))
  const body = options.body === undefined ? undefined : JSON.stringify(options.body)
  return toWebHandler(app)(new Request(
    `https://ctf.example.test/api/contests/test${options.query ?? ''}`,
    {
      method: options.method ?? (body ? 'POST' : 'GET'),
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body,
    },
  ))
}

describe('participation HTTP adapters', () => {
  it('allows an unverified identity to read current status but not create a registration', async () => {
    const dependencies = createDependencies({ ...verifiedSubject, emailVerified: false })
    const current = await invoke(
      (event, deps) => handleCurrentParticipation(event, contestId, deps),
      dependencies,
    )
    expect(current.status).toBe(200)
    expect(dependencies.participations.current).toHaveBeenCalledOnce()

    const registration = await invoke(
      (event, deps) => handleRegisterParticipation(event, contestId, deps),
      dependencies,
      { body: {} },
    )
    expect(registration.status).toBe(403)
    await expect(registration.json()).resolves.toMatchObject({
      error: { code: 'identity.email_verification_required' },
    })
    expect(dependencies.participations.register).not.toHaveBeenCalled()
  })

  it('passes a validated contest invite to the registration command', async () => {
    const dependencies = createDependencies()
    const inviteCode = 'contest-invite-value-00000000000000000001'
    const response = await invoke(
      (event, deps) => handleRegisterParticipation(event, contestId, deps),
      dependencies,
      { body: { invite_code: inviteCode } },
    )

    expect(response.status).toBe(201)
    expect(dependencies.participations.register).toHaveBeenCalledWith(
      verifiedSubject,
      contestId,
      inviteCode,
    )
  })

  it('allows organizer review and rejects an ordinary user before the command runs', async () => {
    const input = { decision: 'accepted', reason: 'Eligibility reviewed' }
    const ordinary = createDependencies()
    const forbidden = await invoke(
      (event, deps) => handleReviewParticipation(event, contestId, participationId, deps),
      ordinary,
      { body: input },
    )
    expect(forbidden.status).toBe(403)
    expect(ordinary.participations.review).not.toHaveBeenCalled()

    const organizerSubject = { ...verifiedSubject, role: 'organizer' as const }
    const organizer = createDependencies(organizerSubject)
    const accepted = await invoke(
      (event, deps) => handleReviewParticipation(event, contestId, participationId, deps),
      organizer,
      { body: input },
    )
    expect(accepted.status).toBe(200)
    expect(organizer.participations.review).toHaveBeenCalledWith(organizerSubject, {
      requestId,
      contestId,
      participationId,
      ...input,
    })
  })

  it('maps eligibility failures and management pagination to stable contracts', async () => {
    const organizer = createDependencies({ ...verifiedSubject, role: 'organizer' }, {
      review: vi.fn(async () => {
        throw new ParticipationServiceError('participation.team_size_invalid', {
          team_size: ['实际 6 人，要求 1–5 人'],
        })
      }),
    })
    const rejected = await invoke(
      (event, deps) => handleReviewParticipation(event, contestId, participationId, deps),
      organizer,
      { body: { decision: 'accepted', reason: 'Eligibility reviewed' } },
    )
    expect(rejected.status).toBe(409)
    await expect(rejected.json()).resolves.toMatchObject({
      error: {
        code: 'participation.team_size_invalid',
        fields: { team_size: ['实际 6 人，要求 1–5 人'] },
      },
    })

    const listed = await invoke(
      (event, deps) => handleListParticipations(event, contestId, deps),
      organizer,
      { query: '?limit=1&status=pending' },
    )
    expect(listed.status).toBe(200)
    expect(organizer.participations.list).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'organizer' }),
      contestId,
      undefined,
      1,
      'pending',
    )
  })
})
