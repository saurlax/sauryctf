import { createApp, eventHandler, setResponseStatus, toWebHandler, type H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import type { ChallengeTemplateDetail } from '../../domains/challenges/repository'
import { ChallengeTemplateServiceError } from '../../domains/challenges/service'
import { DisabledHumanVerificationProvider } from '../../domains/identity/human-verification'
import type { SessionSubject } from '../../domains/identity/repository'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from '../security/rate-limit'
import {
  handleCreateChallengeTemplate,
  handleCreateChallengeTemplateVersion,
  handleReadChallengeTemplate,
  type ChallengeTemplateHttpDependencies,
} from './challenge-template-http'

const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f40'
const userId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f41'
const templateId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f42'
const versionId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f43'
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
const detail: ChallengeTemplateDetail = {
  template: {
    id: templateId,
    name: 'Web Template',
    slug: 'web-template',
    latestVersion: 1,
    version: 1,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  },
  challengeVersion: {
    id: versionId,
    templateId,
    versionNumber: 1,
    title: 'Web Challenge',
    category: 'web' as const,
    description: 'Challenge statement',
    flagFormat: 'flag{...}',
    flagPolicy: { type: 'static', digest: 'masked' },
    scoringPolicy: { type: 'fixed-v1', points: 500 },
    instancePolicy: { type: 'none' },
    assets: [],
    hints: [],
    createdBy: userId,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  },
}

function dependencies(
  subject: SessionSubject = organizer,
  overrides: Partial<ChallengeTemplateHttpDependencies['challengeTemplates']> = {},
): ChallengeTemplateHttpDependencies {
  return {
    identity: {
      identity: {} as ChallengeTemplateHttpDependencies['identity']['identity'],
      sessions: { validate: vi.fn(async () => subject) },
      humanVerification: new DisabledHumanVerificationProvider(),
      rateLimits: new MemoryRateLimitStore(),
      browserSession: { read: vi.fn(async () => session), replace: vi.fn(), clear: vi.fn() },
    },
    challengeTemplates: {
      create: vi.fn(async () => detail),
      createVersion: vi.fn(async () => ({
        ...detail,
        template: { ...detail.template, latestVersion: 2, version: 2 },
        challengeVersion: { ...detail.challengeVersion, versionNumber: 2 },
      })),
      read: vi.fn(async () => detail),
      ...overrides,
    },
  }
}

async function invoke(
  handler: (event: H3Event) => Promise<unknown>,
  body?: unknown,
  options: { method?: string, headers?: Record<string, string> } = {},
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
  return toWebHandler(app)(new Request('https://ctf.example.test/api/admin/challenge-templates', {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? options.headers : { 'content-type': 'application/json', ...options.headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

const createInput = {
  name: 'Web Template',
  slug: 'web-template',
  title: 'Web Challenge',
  category: 'web',
  description: 'Challenge statement',
  flag_format: 'flag{...}',
  flag_policy: { type: 'static', digest: 'masked' },
  scoring_policy: { type: 'fixed-v1', points: 500 },
  instance_policy: { type: 'none' },
  assets: [],
  hints: [],
}

describe('challenge template HTTP adapters', () => {
  it('creates an initial version and returns a strong template ETag', async () => {
    const deps = dependencies()
    const response = await invoke(event => handleCreateChallengeTemplate(event, deps), createInput)
    expect(response.status).toBe(201)
    expect(response.headers.get('etag')).toBe('"1"')
    expect(deps.challengeTemplates.create).toHaveBeenCalledWith(organizer, expect.objectContaining({
      requestId,
      slug: 'web-template',
      category: 'web',
      assets: [],
    }))
  })

  it('requires If-Match and creates a new immutable version', async () => {
    const deps = dependencies()
    const body = { description: 'Clarified statement', reason: 'Clarify the statement' }
    const missing = await invoke(
      event => handleCreateChallengeTemplateVersion(event, templateId, deps),
      body,
    )
    expect(missing.status).toBe(428)
    const created = await invoke(
      event => handleCreateChallengeTemplateVersion(event, templateId, deps),
      body,
      { headers: { 'if-match': '"1"' } },
    )
    expect(created.status).toBe(201)
    expect(created.headers.get('etag')).toBe('"2"')
    expect(deps.challengeTemplates.createVersion).toHaveBeenCalledWith(organizer, expect.objectContaining({
      templateId,
      expectedVersion: 1,
      description: 'Clarified statement',
    }))
  })

  it('reads the requested historical version', async () => {
    const deps = dependencies()
    const response = await invoke(event => handleReadChallengeTemplate(event, templateId, 1, deps))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      template: { id: templateId },
      challenge_version: { id: versionId, version_number: 1 },
    })
    expect(deps.challengeTemplates.read).toHaveBeenCalledWith(organizer, templateId, 1)
  })

  it('rejects unsupported categories before calling the domain service', async () => {
    const deps = dependencies()
    const response = await invoke(event => handleCreateChallengeTemplate(event, deps), {
      ...createInput,
      category: 'awd',
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'validation.failed', fields: { category: expect.any(Array) } },
    })
    expect(deps.challengeTemplates.create).not.toHaveBeenCalled()
  })

  it('maps unavailable attachment details and denies ordinary users', async () => {
    const objectId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f44'
    const unavailable = dependencies(organizer, {
      create: vi.fn(async () => {
        throw new ChallengeTemplateServiceError('challenge.asset_unavailable', {
          [`assets.${objectId}`]: ['内容对象不存在、未提交或已被隔离'],
        })
      }),
    })
    const failed = await invoke(event => handleCreateChallengeTemplate(event, unavailable), createInput)
    expect(failed.status).toBe(409)
    await expect(failed.json()).resolves.toMatchObject({
      error: { code: 'challenge.asset_unavailable', fields: { [`assets.${objectId}`]: expect.any(Array) } },
    })

    const denied = dependencies({ ...organizer, role: 'user' })
    const forbidden = await invoke(event => handleCreateChallengeTemplate(event, denied), createInput)
    expect(forbidden.status).toBe(403)
    expect(denied.challengeTemplates.create).not.toHaveBeenCalled()
  })
})
