import { createApp, eventHandler, setResponseStatus, toWebHandler, type H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import type { SessionSubject } from '../../domains/identity/repository'
import { DisabledHumanVerificationProvider } from '../../domains/identity/human-verification'
import { ContestServiceError } from '../../domains/contests/service'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from '../security/rate-limit'
import {
  handleArchiveContest,
  handleCreateContestDraft,
  handlePublicContest,
  handlePublishContest,
  type ContestHttpDependencies,
} from './contest-http'

const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c'
const userId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2d'
const contestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2e'
const session: AuthSessionData = { user_id: userId, session_version: 1, logged_in_at: '2026-09-01T07:08:09.123Z' }
const organizer: SessionSubject = {
  userId, username: 'Organizer', email: 'organizer@example.test', emailVerified: true,
  status: 'active', role: 'organizer', sessionVersion: 1, mustChangePassword: false,
}
const record = {
  id: contestId, title: 'Autumn CTF', slug: 'autumn-ctf', description: 'Contest',
  publicationStatus: 'draft' as const, phase: null, startAt: new Date('2026-10-01T00:00:00.000Z'),
  endAt: new Date('2026-10-01T08:00:00.000Z'), publishedAt: null, archivedAt: null, version: 1,
}

function dependencies(subject: SessionSubject = organizer, overrides: Partial<ContestHttpDependencies['contests']> = {}): ContestHttpDependencies {
  return {
    identity: {
      identity: {} as ContestHttpDependencies['identity']['identity'],
      sessions: { validate: vi.fn(async () => subject) },
      humanVerification: new DisabledHumanVerificationProvider(), rateLimits: new MemoryRateLimitStore(),
      browserSession: { read: vi.fn(async () => session), replace: vi.fn(), clear: vi.fn() },
    },
    contests: {
      createDraft: vi.fn(async () => record), readManaged: vi.fn(async () => record), readPublic: vi.fn(async () => record),
      publish: vi.fn(async () => ({ ...record, publicationStatus: 'published' as const, phase: 'upcoming' as const, publishedAt: new Date(), version: 2 })),
      archive: vi.fn(async () => ({ ...record, publicationStatus: 'archived' as const, phase: 'ended' as const, publishedAt: new Date(), archivedAt: new Date(), version: 3 })),
      ...overrides,
    },
  }
}

async function invoke(handler: (event: H3Event) => Promise<unknown>, body?: unknown) {
  const app = createApp()
  app.use(eventHandler(async (event) => {
    event.context.requestId = requestId
    try { return await handler(event) }
    catch (error) {
      const response = normalizeApiError(error, requestId)
      setResponseStatus(event, response.statusCode)
      return response.body
    }
  }))
  return toWebHandler(app)(new Request('https://ctf.example.test/api/contests/test', {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

describe('contest HTTP adapters', () => {
  it('allows organizer draft creation and rejects an ordinary user', async () => {
    const input = { title: 'Autumn CTF', slug: 'autumn-ctf', description: 'Contest', start_at: '2026-10-01T00:00:00.000Z', end_at: '2026-10-01T08:00:00.000Z' }
    const allowed = dependencies()
    const created = await invoke(event => handleCreateContestDraft(event, allowed), input)
    expect(created.status).toBe(201)
    expect(allowed.contests.createDraft).toHaveBeenCalledWith(organizer, expect.objectContaining({ requestId, slug: 'autumn-ctf' }))

    const denied = dependencies({ ...organizer, role: 'user' })
    const forbidden = await invoke(event => handleCreateContestDraft(event, denied), input)
    expect(forbidden.status).toBe(403)
    expect(denied.contests.createDraft).not.toHaveBeenCalled()
  })

  it('projects lifecycle transitions and request audit context', async () => {
    const deps = dependencies()
    const published = await invoke(event => handlePublishContest(event, contestId, deps), { reason: 'Open scheduled contest' })
    expect(published.status).toBe(200)
    expect(deps.contests.publish).toHaveBeenCalledWith(organizer, { requestId, contestId, reason: 'Open scheduled contest' })
    const archived = await invoke(event => handleArchiveContest(event, contestId, deps), { reason: 'Archive completed contest' })
    expect(archived.status).toBe(200)
  })

  it('maps an early archive to the stable lifecycle error', async () => {
    const deps = dependencies(organizer, { archive: vi.fn(async () => { throw new ContestServiceError('contest.not_ended') }) })
    const response = await invoke(event => handleArchiveContest(event, contestId, deps), { reason: 'Archive completed contest' })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'contest.not_ended' } })
  })

  it('serves a public contest without requiring identity dependencies', async () => {
    const deps = dependencies()
    const response = await invoke(event => handlePublicContest(event, contestId, { contests: deps.contests }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ contest: { id: contestId, publication_status: 'draft' } })
  })
})
