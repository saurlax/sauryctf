import { createApp, eventHandler, setResponseStatus, toWebHandler, type H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import type { SessionSubject } from '../../domains/identity/repository'
import { DisabledHumanVerificationProvider } from '../../domains/identity/human-verification'
import { AnnouncementServiceError } from '../../domains/announcements/service'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from '../security/rate-limit'
import {
  handleCreateAnnouncement,
  handleListManagedAnnouncements,
  handleListPublicAnnouncements,
  handleUpdateAnnouncement,
  handleWithdrawAnnouncement,
  type AnnouncementHttpDependencies,
} from './announcement-http'

const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c'
const userId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2d'
const contestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2e'
const announcementId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2f'
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
const record = {
  id: announcementId,
  contestId,
  title: 'Competition notice',
  body: 'The competition begins on schedule.',
  status: 'scheduled' as const,
  publishAt: new Date('2026-10-01T00:00:00.000Z'),
  withdrawnAt: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  version: 1,
}

function dependencies(
  subject: SessionSubject = organizer,
  overrides: Partial<AnnouncementHttpDependencies['announcements']> = {},
): AnnouncementHttpDependencies {
  return {
    identity: {
      identity: {} as AnnouncementHttpDependencies['identity']['identity'],
      sessions: { validate: vi.fn(async () => subject) },
      humanVerification: new DisabledHumanVerificationProvider(),
      rateLimits: new MemoryRateLimitStore(),
      browserSession: {
        read: vi.fn(async () => session),
        replace: vi.fn(),
        clear: vi.fn(),
      },
    },
    announcements: {
      create: vi.fn(async () => record),
      listManaged: vi.fn(async () => ({ items: [record], nextCursor: null, hasMore: false })),
      listPublic: vi.fn(async () => ({ items: [record], nextCursor: null, hasMore: false })),
      update: vi.fn(async () => ({ ...record, title: 'Updated notice', version: 2 })),
      withdraw: vi.fn(async () => ({
        ...record,
        status: 'withdrawn' as const,
        withdrawnAt: new Date('2026-09-02T00:00:00.000Z'),
        version: 2,
      })),
      ...overrides,
    },
  }
}

async function invoke(
  handler: (event: H3Event) => Promise<unknown>,
  body?: unknown,
  options: { method?: string, headers?: Record<string, string>, query?: string } = {},
) {
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
    `https://ctf.example.test/api/contests/test${options.query ?? ''}`,
    {
      method: options.method ?? (body === undefined ? 'GET' : 'POST'),
      headers: body === undefined
        ? options.headers
        : { 'content-type': 'application/json', ...options.headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  ))
}

describe('announcement HTTP adapters', () => {
  it('creates announcements for organizers and returns the resource ETag', async () => {
    const deps = dependencies()
    const response = await invoke(
      event => handleCreateAnnouncement(event, contestId, deps),
      {
        title: ' Competition notice ',
        body: ' The competition begins on schedule. ',
        publish_at: '2026-10-01T00:00:00.000Z',
      },
    )
    expect(response.status).toBe(201)
    expect(response.headers.get('etag')).toBe('"1"')
    await expect(response.json()).resolves.toMatchObject({
      announcement: {
        id: announcementId,
        status: 'scheduled',
        publish_at: '2026-10-01T00:00:00.000Z',
      },
    })
    expect(deps.announcements.create).toHaveBeenCalledWith(organizer, {
      requestId,
      contestId,
      title: 'Competition notice',
      body: 'The competition begins on schedule.',
      publishAt: new Date('2026-10-01T00:00:00.000Z'),
    })
  })

  it('rejects ordinary users before an announcement management command is called', async () => {
    const deps = dependencies({ ...organizer, role: 'user' })
    const response = await invoke(
      event => handleCreateAnnouncement(event, contestId, deps),
      {
        title: 'Unauthorized notice',
        body: 'Must not be created.',
        publish_at: '2026-10-01T00:00:00.000Z',
      },
    )
    expect(response.status).toBe(403)
    expect(deps.announcements.create).not.toHaveBeenCalled()
  })

  it('requires a strong If-Match for update and withdrawal', async () => {
    const deps = dependencies()
    const missing = await invoke(
      event => handleUpdateAnnouncement(event, contestId, announcementId, deps),
      { title: 'Updated notice', reason: 'Correct the title' },
      { method: 'PATCH' },
    )
    expect(missing.status).toBe(428)
    expect(deps.announcements.update).not.toHaveBeenCalled()

    const weak = await invoke(
      event => handleWithdrawAnnouncement(event, contestId, announcementId, deps),
      { reason: 'Withdraw obsolete notice' },
      { headers: { 'if-match': 'W/"1"' } },
    )
    expect(weak.status).toBe(428)
    expect(deps.announcements.withdraw).not.toHaveBeenCalled()
  })

  it('maps update and withdrawal inputs to versioned commands', async () => {
    const deps = dependencies()
    const updated = await invoke(
      event => handleUpdateAnnouncement(event, contestId, announcementId, deps),
      {
        title: 'Updated notice',
        publish_at: '2026-10-02T00:00:00.000Z',
        reason: 'Move to the confirmed publication time',
      },
      { method: 'PATCH', headers: { 'if-match': '"1"' } },
    )
    expect(updated.status).toBe(200)
    expect(updated.headers.get('etag')).toBe('"2"')
    expect(deps.announcements.update).toHaveBeenCalledWith(organizer, expect.objectContaining({
      requestId,
      contestId,
      announcementId,
      expectedVersion: 1,
      title: 'Updated notice',
      publishAt: new Date('2026-10-02T00:00:00.000Z'),
    }))

    const withdrawn = await invoke(
      event => handleWithdrawAnnouncement(event, contestId, announcementId, deps),
      { reason: 'The information is no longer valid' },
      { headers: { 'if-match': '"1"' } },
    )
    expect(withdrawn.status).toBe(200)
    expect(deps.announcements.withdraw).toHaveBeenCalledWith(organizer, expect.objectContaining({
      expectedVersion: 1,
      reason: 'The information is no longer valid',
    }))
  })

  it('validates bodies and maps stable domain errors', async () => {
    const invalid = dependencies()
    const invalidResponse = await invoke(
      event => handleUpdateAnnouncement(event, contestId, announcementId, invalid),
      { reason: 'No actual field update' },
      { method: 'PATCH', headers: { 'if-match': '"1"' } },
    )
    expect(invalidResponse.status).toBe(400)
    await expect(invalidResponse.json()).resolves.toMatchObject({
      error: { code: 'validation.failed', fields: { request: expect.any(Array) } },
    })

    const conflict = dependencies(organizer, {
      update: vi.fn(async () => {
        throw new AnnouncementServiceError('resource.version_conflict')
      }),
    })
    const conflictResponse = await invoke(
      event => handleUpdateAnnouncement(event, contestId, announcementId, conflict),
      { body: 'Updated body', reason: 'Update with a stale version' },
      { method: 'PATCH', headers: { 'if-match': '"1"' } },
    )
    expect(conflictResponse.status).toBe(409)
    await expect(conflictResponse.json()).resolves.toMatchObject({
      error: { code: 'resource.version_conflict', request_id: requestId },
    })
  })

  it('provides cursor pagination to managers and public readers without requiring a public session', async () => {
    const deps = dependencies()
    const managed = await invoke(
      event => handleListManagedAnnouncements(event, contestId, deps),
      undefined,
      { query: `?cursor=${announcementId}&limit=10` },
    )
    expect(managed.status).toBe(200)
    expect(deps.announcements.listManaged).toHaveBeenCalledWith(
      organizer,
      contestId,
      announcementId,
      10,
    )

    const publicResponse = await invoke(
      event => handleListPublicAnnouncements(event, contestId, { announcements: deps.announcements }),
    )
    expect(publicResponse.status).toBe(200)
    expect(deps.announcements.listPublic).toHaveBeenCalledWith(contestId, undefined, 50)
    await expect(publicResponse.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: announcementId })],
      page: { next_cursor: null, has_more: false },
    })
  })
})
