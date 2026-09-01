import { createApp, eventHandler, setResponseStatus, toWebHandler, type H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import type { ContestChallengeRecord } from '../../domains/challenges/contest-challenge-repository'
import { ContestChallengeServiceError } from '../../domains/challenges/contest-challenge-service'
import { DisabledHumanVerificationProvider } from '../../domains/identity/human-verification'
import type { SessionSubject } from '../../domains/identity/repository'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from '../security/rate-limit'
import {
  handleMountContestChallenge,
  handleReadContestChallenge,
  handleReviseContestChallenge,
  type ContestChallengeHttpDependencies,
} from './contest-challenge-http'

const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f50'
const userId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f51'
const contestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f52'
const challengeId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f53'
const templateId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f54'
const versionId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f55'
const objectId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f56'
const hintId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f57'
const assetId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f58'
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
const record: ContestChallengeRecord = {
  id: challengeId,
  contestId,
  sourceTemplateId: templateId,
  sourceVersionId: versionId,
  sourceVersionNumber: 1,
  snapshotRevision: 1,
  title: 'Web Challenge',
  category: 'web' as const,
  description: 'Contest statement snapshot',
  flagFormat: 'flag{...}',
  flagPolicy: { type: 'static', digest: 'masked' },
  scoringPolicy: { type: 'fixed-v1', points: 500 },
  instancePolicy: { type: 'none' },
  assets: [{ id: assetId, contentObjectId: objectId, displayName: 'starter.zip', sortOrder: 0 }],
  hints: [{
    id: hintId,
    title: 'Hint',
    content: 'Inspect headers',
    releaseAt: new Date('2026-09-02T00:15:00.000Z'),
    sortOrder: 0,
  }],
  enabled: true,
  publishAt: new Date('2026-09-02T00:00:00.000Z'),
  closeAt: null,
  submissionLimit: 100,
  sortOrder: 0,
  version: 1,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
}

function dependencies(
  subject: SessionSubject = organizer,
  overrides: Partial<ContestChallengeHttpDependencies['contestChallenges']> = {},
): ContestChallengeHttpDependencies {
  return {
    identity: {
      identity: {} as ContestChallengeHttpDependencies['identity']['identity'],
      sessions: { validate: vi.fn(async () => subject) },
      humanVerification: new DisabledHumanVerificationProvider(),
      rateLimits: new MemoryRateLimitStore(),
      browserSession: { read: vi.fn(async () => session), replace: vi.fn(), clear: vi.fn() },
    },
    contestChallenges: {
      mount: vi.fn(async () => record),
      read: vi.fn(async () => record),
      revise: vi.fn(async () => ({
        ...record,
        description: 'Corrected statement',
        snapshotRevision: 2,
        version: 2,
      })),
      ...overrides,
    },
  }
}

async function invoke(
  handler: (event: H3Event) => Promise<unknown>,
  body?: unknown,
  headers: Record<string, string> = {},
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
  return toWebHandler(app)(new Request('https://ctf.example.test/api/admin/contests/x/challenges', {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

describe('contest challenge snapshot HTTP adapters', () => {
  it('mounts one selected template version and returns a strong challenge ETag', async () => {
    const deps = dependencies()
    const response = await invoke(event => handleMountContestChallenge(event, contestId, deps), {
      template_version_id: versionId,
      enabled: true,
      publish_at: '2026-09-02T00:00:00.000Z',
      close_at: null,
      submission_limit: 100,
      sort_order: 0,
    })
    expect(response.status).toBe(201)
    expect(response.headers.get('etag')).toBe('"1"')
    expect(deps.contestChallenges.mount).toHaveBeenCalledWith(organizer, expect.objectContaining({
      requestId,
      contestId,
      templateVersionId: versionId,
      publishAt: new Date('2026-09-02T00:00:00.000Z'),
    }))
  })

  it('reads a complete managed snapshot including copied assets and hints', async () => {
    const deps = dependencies()
    const response = await invoke(event => handleReadContestChallenge(
      event,
      contestId,
      challengeId,
      deps,
    ))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      challenge: {
        id: challengeId,
        source_version_number: 1,
        snapshot_revision: 1,
        assets: [{ content_object_id: objectId }],
        hints: [{ title: 'Hint', release_at: '2026-09-02T00:15:00.000Z' }],
      },
    })
  })

  it('requires If-Match and maps a published emergency revision', async () => {
    const deps = dependencies()
    const body = { reason: 'Correct the published statement', description: 'Corrected statement' }
    const missing = await invoke(
      event => handleReviseContestChallenge(event, contestId, challengeId, deps),
      body,
    )
    expect(missing.status).toBe(428)
    const revised = await invoke(
      event => handleReviseContestChallenge(event, contestId, challengeId, deps),
      body,
      { 'if-match': '"1"' },
    )
    expect(revised.status).toBe(200)
    expect(revised.headers.get('etag')).toBe('"2"')
    expect(deps.contestChallenges.revise).toHaveBeenCalledWith(organizer, expect.objectContaining({
      expectedVersion: 1,
      reason: 'Correct the published statement',
      description: 'Corrected statement',
    }))
  })

  it('rejects ordinary users, invalid windows, and domain conflicts without mutation', async () => {
    const ordinary = dependencies({ ...organizer, role: 'user' })
    const denied = await invoke(event => handleMountContestChallenge(event, contestId, ordinary), {
      template_version_id: versionId,
    })
    expect(denied.status).toBe(403)
    expect(ordinary.contestChallenges.mount).not.toHaveBeenCalled()

    const deps = dependencies()
    const invalid = await invoke(event => handleMountContestChallenge(event, contestId, deps), {
      template_version_id: versionId,
      publish_at: '2026-09-03T00:00:00.000Z',
      close_at: '2026-09-02T00:00:00.000Z',
    })
    expect(invalid.status).toBe(400)
    expect(deps.contestChallenges.mount).not.toHaveBeenCalled()

    const unavailable = dependencies(organizer, {
      revise: vi.fn(async () => {
        throw new ContestChallengeServiceError('challenge.asset_unavailable', {
          [`assets.${objectId}`]: ['内容对象不存在、未提交或已被隔离'],
        })
      }),
    })
    const failed = await invoke(
      event => handleReviseContestChallenge(event, contestId, challengeId, unavailable),
      { reason: 'Replace a broken attachment', assets: [{ content_object_id: objectId, display_name: 'x.zip' }] },
      { 'if-match': '"1"' },
    )
    expect(failed.status).toBe(409)
    await expect(failed.json()).resolves.toMatchObject({
      error: { code: 'challenge.asset_unavailable', fields: { [`assets.${objectId}`]: expect.any(Array) } },
    })
  })
})
