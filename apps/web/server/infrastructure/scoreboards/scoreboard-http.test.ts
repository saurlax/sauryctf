import { createApp, eventHandler, setResponseStatus, toWebHandler, type H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import { DisabledHumanVerificationProvider } from '../../domains/identity/human-verification'
import type { SessionSubject } from '../../domains/identity/repository'
import { ScoreboardViewServiceError } from '../../domains/scoreboards/view-service'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from '../security/rate-limit'
import {
  handleInternalScoreboard,
  handlePublicScoreboard,
  type ScoreboardHttpDependencies,
} from './scoreboard-http'

const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c'
const userId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2d'
const contestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2e'
const participationId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f30'
const teamId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f31'
const divisionId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f32'
const challengeId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f33'
const solveId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f34'
const session: AuthSessionData = {
  user_id: userId,
  session_version: 1,
  logged_in_at: '2026-09-01T07:08:09.123Z',
}
const organizer: SessionSubject = {
  userId,
  username: 'Organizer',
  email: 'organizer@example.test',
  emailVerified: true,
  status: 'active',
  role: 'organizer',
  sessionVersion: 1,
  mustChangePassword: false,
}

function projection(view: 'public' | 'internal' = 'public') {
  return {
    schema: 'scoreboard-projection.v1' as const,
    contestId,
    view,
    state: view === 'public' ? 'frozen' as const : 'live' as const,
    freshness: 'current' as const,
    version: view === 'public' ? 1 : 2,
    frozenAt: view === 'public' ? '2026-09-01T08:00:00.000Z' : null,
    builtAt: '2026-09-01T08:00:00.000Z',
    board: {
      schema: 'scoreboard.v1' as const,
      scope: { type: 'division' as const, divisionId },
      scopeKey: divisionId,
      challenges: [{
        challengeId,
        officialSolveCount: 1,
        currentPoints: 500,
        firstSolveParticipationId: participationId,
      }],
      rows: [{
        rank: 1,
        participationId,
        teamId,
        teamName: 'Team One',
        divisionId,
        totalPoints: 500,
        solvePoints: 500,
        adjustmentPoints: 0,
        officialSolveCount: 1,
        lastScoringAt: '2026-09-01T07:55:00.000Z',
        solves: [{ solveId, challengeId, solvedAt: '2026-09-01T07:55:00.000Z' }],
      }],
    },
  }
}

function dependencies(
  subject: SessionSubject = organizer,
  overrides: Partial<ScoreboardHttpDependencies['scoreboards']> = {},
): ScoreboardHttpDependencies {
  return {
    identity: {
      identity: {} as ScoreboardHttpDependencies['identity']['identity'],
      sessions: { validate: vi.fn(async () => subject) },
      humanVerification: new DisabledHumanVerificationProvider(),
      rateLimits: new MemoryRateLimitStore(),
      browserSession: {
        read: vi.fn(async () => session),
        replace: vi.fn(),
        clear: vi.fn(),
      },
    },
    scoreboards: {
      read: vi.fn(async input => projection(input.view)),
      ...overrides,
    },
  }
}

async function invoke(handler: (event: H3Event) => Promise<unknown>, query = '') {
  const app = createApp()
  app.use(eventHandler(async (event) => {
    event.context.requestId = requestId
    try {
      return await handler(event)
    }
    catch (error) {
      const response = normalizeApiError(error, requestId)
      setResponseStatus(event, response.statusCode)
      return response.body
    }
  }))
  return toWebHandler(app)(new Request(
    `https://ctf.example.test/api/contests/${contestId}/scoreboard${query}`,
  ))
}

describe('scoreboard HTTP adapters', () => {
  it('returns a public frozen division projection without requiring a session', async () => {
    const deps = dependencies()
    const response = await invoke(
      event => handlePublicScoreboard(event, contestId, deps),
      `?division_id=${divisionId}`,
    )
    expect(response.status).toBe(200)
    expect(deps.scoreboards.read).toHaveBeenCalledWith({
      contestId,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'division', divisionId },
    })
    await expect(response.json()).resolves.toMatchObject({
      scoreboard: {
        schema: 'scoreboard-projection.v1',
        contest_id: contestId,
        view: 'public',
        state: 'frozen',
        freshness: 'current',
        version: 1,
        frozen_at: '2026-09-01T08:00:00.000Z',
        scope: { type: 'division', division_id: divisionId },
        rows: [{ participation_id: participationId, total_points: 500 }],
      },
    })
  })

  it('allows organizer internal reads and rejects ordinary users before the service call', async () => {
    const allowed = dependencies()
    const response = await invoke(
      event => handleInternalScoreboard(event, contestId, allowed),
      `?division_id=${divisionId}`,
    )
    expect(response.status).toBe(200)
    expect(allowed.scoreboards.read).toHaveBeenCalledWith(expect.objectContaining({
      view: 'internal',
      viewerRole: 'organizer',
    }))

    const denied = dependencies({ ...organizer, role: 'user' })
    const forbidden = await invoke(
      event => handleInternalScoreboard(event, contestId, denied),
      `?division_id=${divisionId}`,
    )
    expect(forbidden.status).toBe(403)
    expect(denied.scoreboards.read).not.toHaveBeenCalled()
  })

  it('validates division ids and maps service errors to stable responses', async () => {
    const invalid = dependencies()
    const malformed = await invoke(
      event => handlePublicScoreboard(event, contestId, invalid),
      '?division_id=not-a-uuid',
    )
    expect(malformed.status).toBe(400)
    expect(invalid.scoreboards.read).not.toHaveBeenCalled()

    const missing = dependencies(organizer, {
      read: vi.fn(async () => {
        throw new ScoreboardViewServiceError('scoreboard.not_found', '排行榜不存在或尚未公开')
      }),
    })
    const notFound = await invoke(event => handlePublicScoreboard(event, contestId, missing))
    expect(notFound.status).toBe(404)
    await expect(notFound.json()).resolves.toMatchObject({
      error: { code: 'scoreboard.not_found', request_id: requestId },
    })
  })
})
