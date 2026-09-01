import { createApp, eventHandler, setResponseStatus, toWebHandler, type H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import type { SessionSubject } from '../../domains/identity/repository'
import type { WriteupRecord } from '../../domains/writeups/repository'
import { WriteupServiceError } from '../../domains/writeups/service'
import { DisabledHumanVerificationProvider } from '../../domains/identity/human-verification'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from '../security/rate-limit'
import {
  handleCorrectWriteup,
  handleExportSubmittedWriteups,
  handleListManagedWriteups,
  handleOwnWriteup,
  handleReviewWriteup,
  handleSaveOwnWriteup,
  handleSubmitOwnWriteup,
  type WriteupHttpDependencies,
} from './writeup-http'

const requestId = '018f47a2-4ef8-7e2c-9c24-000000000201'
const userId = '018f47a2-4ef8-7e2c-9c24-000000000202'
const contestId = '018f47a2-4ef8-7e2c-9c24-000000000203'
const writeupId = '018f47a2-4ef8-7e2c-9c24-000000000204'
const participationId = '018f47a2-4ef8-7e2c-9c24-000000000205'
const teamId = '018f47a2-4ef8-7e2c-9c24-000000000206'
const versionId = '018f47a2-4ef8-7e2c-9c24-000000000207'
const session: AuthSessionData = {
  user_id: userId,
  session_version: 1,
  logged_in_at: '2026-09-02T06:00:00.000Z',
}
const organizer: SessionSubject = {
  userId,
  username: 'WriteupOrganizer',
  email: 'writeup-organizer@example.test',
  emailVerified: true,
  status: 'active',
  role: 'organizer',
  sessionVersion: 1,
  mustChangePassword: false,
}
const record: WriteupRecord = {
  id: writeupId,
  contestId,
  participationId,
  teamId,
  teamName: 'Blue Team',
  status: 'submitted',
  currentVersion: 1,
  submittedVersion: 1,
  submittedAt: new Date('2026-09-02T06:00:00.000Z'),
  reviewedBy: null,
  reviewNote: null,
  reviewedAt: null,
  version: 2,
  updatedAt: new Date('2026-09-02T06:00:00.000Z'),
  current: {
    id: versionId,
    versionNumber: 1,
    body: 'Writeup body',
    createdBy: userId,
    createdAt: new Date('2026-09-02T05:59:00.000Z'),
    attachments: [],
  },
  submitted: {
    id: versionId,
    versionNumber: 1,
    body: 'Writeup body',
    createdBy: userId,
    createdAt: new Date('2026-09-02T05:59:00.000Z'),
    attachments: [],
  },
}

function dependencies(
  subject: SessionSubject = organizer,
  overrides: Partial<WriteupHttpDependencies['writeups']> = {},
): WriteupHttpDependencies {
  return {
    identity: {
      identity: {} as WriteupHttpDependencies['identity']['identity'],
      sessions: { validate: vi.fn(async () => subject) },
      humanVerification: new DisabledHumanVerificationProvider(),
      rateLimits: new MemoryRateLimitStore(),
      browserSession: { read: vi.fn(async () => session), replace: vi.fn(), clear: vi.fn() },
    },
    writeups: {
      readOwn: vi.fn(async () => ({
        contestId,
        writeupRequired: true,
        writeupDeadlineAt: new Date('2026-09-03T00:00:00.000Z'),
        writeup: record,
      })),
      saveOwn: vi.fn(async () => record),
      submitOwn: vi.fn(async () => record),
      listManaged: vi.fn(async () => ({ items: [record], nextCursor: null, hasMore: false })),
      review: vi.fn(async () => ({ ...record, status: 'approved' as const, version: 3 })),
      correct: vi.fn(async () => ({ ...record, currentVersion: 2, submittedVersion: 2, version: 3 })),
      exportSubmitted: vi.fn(async () => ({
        body: Buffer.from('zip-content'),
        filename: `writeups-${contestId}.zip`,
        mediaType: 'application/zip' as const,
      })),
      ...overrides,
    },
  }
}

async function invoke(
  handler: (event: H3Event) => Promise<unknown>,
  request: Request,
) {
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
  return toWebHandler(app)(request)
}

describe('Writeup HTTP adapters', () => {
  it('returns an absent aggregate with ETag zero and requires that precondition for first save', async () => {
    const deps = dependencies(organizer, {
      readOwn: vi.fn(async () => ({
        contestId, writeupRequired: true, writeupDeadlineAt: null, writeup: null,
      })),
    })
    const read = await invoke(
      event => handleOwnWriteup(event, contestId, deps),
      new Request(`https://ctf.example.test/api/contests/${contestId}/writeup`),
    )
    expect(read.status).toBe(200)
    expect(read.headers.get('etag')).toBe('"0"')
    await expect(read.json()).resolves.toMatchObject({ writeup_required: true, writeup: null })

    const missing = await invoke(
      event => handleSaveOwnWriteup(event, contestId, deps),
      new Request(`https://ctf.example.test/api/contests/${contestId}/writeup`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'First version', attachment_ids: [] }),
      }),
    )
    expect(missing.status).toBe(428)
    expect(deps.writeups.saveOwn).not.toHaveBeenCalled()

    const saved = await invoke(
      event => handleSaveOwnWriteup(event, contestId, deps),
      new Request(`https://ctf.example.test/api/contests/${contestId}/writeup`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'if-match': '"0"' },
        body: JSON.stringify({ body: 'First version', attachment_ids: [] }),
      }),
    )
    expect(saved.status).toBe(200)
    expect(saved.headers.get('etag')).toBe('"2"')
    expect(deps.writeups.saveOwn).toHaveBeenCalledWith(organizer, expect.objectContaining({
      contestId, expectedVersion: 0, body: 'First version', attachmentIds: [],
    }))
  })

  it('submits with a strong aggregate version and maps deadline rejection', async () => {
    const deps = dependencies()
    const submitted = await invoke(
      event => handleSubmitOwnWriteup(event, contestId, deps),
      new Request(`https://ctf.example.test/api/contests/${contestId}/writeup/submit`, {
        method: 'POST', headers: { 'if-match': '"2"' },
      }),
    )
    expect(submitted.status).toBe(200)
    expect(deps.writeups.submitOwn).toHaveBeenCalledWith(organizer, {
      contestId, expectedVersion: 2,
    })

    const late = dependencies(organizer, {
      submitOwn: vi.fn(async () => { throw new WriteupServiceError('writeup.deadline_passed') }),
    })
    const rejected = await invoke(
      event => handleSubmitOwnWriteup(event, contestId, late),
      new Request(`https://ctf.example.test/api/contests/${contestId}/writeup/submit`, {
        method: 'POST', headers: { 'if-match': '"2"' },
      }),
    )
    expect(rejected.status).toBe(409)
    await expect(rejected.json()).resolves.toMatchObject({
      error: { code: 'writeup.deadline_passed' },
    })
  })

  it('validates review notes and prevents ordinary users from management access', async () => {
    const deps = dependencies()
    const invalid = await invoke(
      event => handleReviewWriteup(event, contestId, writeupId, deps),
      new Request(`https://ctf.example.test/api/admin/contests/${contestId}/writeups/${writeupId}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'if-match': '"2"' },
        body: JSON.stringify({ decision: 'changes_requested', note: null }),
      }),
    )
    expect(invalid.status).toBe(400)
    expect(deps.writeups.review).not.toHaveBeenCalled()

    const ordinary = dependencies({ ...organizer, role: 'user' })
    const forbidden = await invoke(
      event => handleListManagedWriteups(event, contestId, ordinary),
      new Request(`https://ctf.example.test/api/admin/contests/${contestId}/writeups`),
    )
    expect(forbidden.status).toBe(403)
    expect(ordinary.writeups.listManaged).not.toHaveBeenCalled()
  })

  it('forwards review and correction reason with request and resource versions', async () => {
    const deps = dependencies()
    const reviewed = await invoke(
      event => handleReviewWriteup(event, contestId, writeupId, deps),
      new Request(`https://ctf.example.test/api/admin/contests/${contestId}/writeups/${writeupId}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'if-match': '"2"' },
        body: JSON.stringify({ decision: 'approved', note: 'Reviewed' }),
      }),
    )
    expect(reviewed.status).toBe(200)
    expect(deps.writeups.review).toHaveBeenCalledWith(organizer, expect.objectContaining({
      requestId, contestId, writeupId, expectedVersion: 2,
      decision: 'approved', note: 'Reviewed',
    }))

    const corrected = await invoke(
      event => handleCorrectWriteup(event, contestId, writeupId, deps),
      new Request(`https://ctf.example.test/api/admin/contests/${contestId}/writeups/${writeupId}/corrections`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'if-match': '"2"' },
        body: JSON.stringify({
          body: 'Corrected body', attachment_ids: [], reason: 'Authorized correction',
        }),
      }),
    )
    expect(corrected.status).toBe(200)
    expect(deps.writeups.correct).toHaveBeenCalledWith(organizer, expect.objectContaining({
      requestId, expectedVersion: 2, reason: 'Authorized correction',
    }))
  })

  it('returns a private binary ZIP with a safe fixed filename', async () => {
    const deps = dependencies()
    const response = await invoke(
      event => handleExportSubmittedWriteups(event, contestId, deps),
      new Request(`https://ctf.example.test/api/admin/contests/${contestId}/writeups/export`),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-type')).toContain('application/zip')
    expect(response.headers.get('content-disposition'))
      .toBe(`attachment; filename="writeups-${contestId}.zip"`)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from('zip-content'))
  })
})
