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
  handleContestPublicationCheck,
  handleCreateContestDraft,
  handlePublicContest,
  handlePublishContest,
  handleUpdateContestDraft,
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
  publicationStatus: 'draft' as const, phase: null, visibility: 'public' as const,
  inviteRequired: false, inviteConfigured: false, registrationStrategy: 'review' as const,
  startAt: new Date('2026-10-01T00:00:00.000Z'), endAt: new Date('2026-10-01T08:00:00.000Z'),
  scoreboardFreezeAt: null, practiceEnabled: false, writeupRequired: false,
  writeupDeadlineAt: null, minTeamSize: 1, maxTeamSize: 5,
  registrationConstraints: { allowedEmailDomains: [] },
  publishedAt: null, archivedAt: null, version: 1,
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
      checkPublication: vi.fn(async () => ({ ready: true, issues: [] })),
      updateDraft: vi.fn(async () => ({ ...record, version: 2 })),
      publish: vi.fn(async () => ({ ...record, publicationStatus: 'published' as const, phase: 'upcoming' as const, publishedAt: new Date(), version: 2 })),
      archive: vi.fn(async () => ({ ...record, publicationStatus: 'archived' as const, phase: 'ended' as const, publishedAt: new Date(), archivedAt: new Date(), version: 3 })),
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
  return toWebHandler(app)(new Request('https://ctf.example.test/api/contests/test', {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? options.headers : { 'content-type': 'application/json', ...options.headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

describe('contest HTTP adapters', () => {
  it('allows organizer draft creation and rejects an ordinary user', async () => {
    const input = { title: 'Autumn CTF', slug: 'autumn-ctf', description: 'Contest', start_at: '2026-10-01T00:00:00.000Z', end_at: '2026-10-01T08:00:00.000Z' }
    const allowed = dependencies()
    const created = await invoke(event => handleCreateContestDraft(event, allowed), input)
    expect(created.status).toBe(201)
    expect(created.headers.get('etag')).toBe('"1"')
    expect(allowed.contests.createDraft).toHaveBeenCalledWith(organizer, expect.objectContaining({ requestId, slug: 'autumn-ctf' }))

    const denied = dependencies({ ...organizer, role: 'user' })
    const forbidden = await invoke(event => handleCreateContestDraft(event, denied), input)
    expect(forbidden.status).toBe(403)
    expect(denied.contests.createDraft).not.toHaveBeenCalled()
  })

  it('accepts independent visibility and invite settings with canonical configuration fields', async () => {
    const deps = dependencies()
    const input = {
      title: 'Autumn CTF', slug: 'autumn-ctf', description: 'Contest',
      visibility: 'public', invite_required: true,
      invite_code: 'contest-invite-value-000000000001', registration_strategy: 'auto_accept',
      start_at: '2026-10-01T00:00:00.000Z', end_at: '2026-10-01T08:00:00.000Z',
      scoreboard_freeze_at: '2026-10-01T07:00:00.000Z', practice_enabled: true,
      writeup_required: true, writeup_deadline_at: '2026-10-02T08:00:00.000Z',
      min_team_size: 2, max_team_size: 6,
      registration_constraints: { allowed_email_domains: ['Example.EDU', 'example.edu'] },
    }
    const response = await invoke(event => handleCreateContestDraft(event, deps), input)
    expect(response.status).toBe(201)
    expect(deps.contests.createDraft).toHaveBeenCalledWith(organizer, expect.objectContaining({
      visibility: 'public', inviteRequired: true, inviteCode: input.invite_code,
      registrationStrategy: 'auto_accept', practiceEnabled: true, writeupRequired: true,
      minTeamSize: 2, maxTeamSize: 6,
      allowedEmailDomains: ['Example.EDU', 'example.edu'],
    }))
  })

  it.each([
    ['end_at', { end_at: '2026-10-01T00:00:00.000Z' }],
    ['scoreboard_freeze_at', { scoreboard_freeze_at: '2026-09-30T23:59:59.000Z' }],
    ['scoreboard_freeze_at', { scoreboard_freeze_at: '2026-10-01T08:00:01.000Z' }],
    ['writeup_deadline_at', { writeup_required: true, writeup_deadline_at: '2026-10-01T07:59:59.000Z' }],
    ['writeup_deadline_at', { writeup_required: false, writeup_deadline_at: '2026-10-02T00:00:00.000Z' }],
    ['invite_code', { invite_required: true }],
    ['invite_code', { invite_required: true, invite_code: 'too-short' }],
    ['min_team_size', { min_team_size: 0 }],
    ['max_team_size', { min_team_size: 5, max_team_size: 4 }],
    ['visibility', { visibility: 'hidden' }],
    ['registration_strategy', { registration_strategy: 'instant' }],
    ['registration_constraints.allowed_email_domains.0', {
      registration_constraints: { allowed_email_domains: ['invalid_domain!'] },
    }],
  ])('returns a field error for invalid %s configuration', async (field, override) => {
    const input = {
      title: 'Autumn CTF', slug: 'autumn-ctf', description: 'Contest',
      start_at: '2026-10-01T00:00:00.000Z', end_at: '2026-10-01T08:00:00.000Z',
      ...override,
    }
    const deps = dependencies()
    const response = await invoke(event => handleCreateContestDraft(event, deps), input)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'validation.failed', fields: { [field]: expect.any(Array) } },
    })
    expect(deps.contests.createDraft).not.toHaveBeenCalled()
  })

  it.each(['awd', 'mixed', 'unknown', 'jeopardy'])(
    'rejects explicit contest mode %s before invoking the creation service',
    async (mode) => {
      const deps = dependencies()
      const response = await invoke(event => handleCreateContestDraft(event, deps), {
        title: 'Unsupported Mode Contest',
        slug: 'unsupported-mode-contest',
        description: '',
        start_at: '2026-10-01T00:00:00.000Z',
        end_at: '2026-10-01T08:00:00.000Z',
        mode,
      })
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: 'contest.mode_unsupported',
          fields: { mode: expect.any(Array) },
        },
      })
      expect(deps.contests.createDraft).not.toHaveBeenCalled()
    },
  )

  it('requires and forwards a strong resource version for draft updates', async () => {
    const deps = dependencies()
    const missing = await invoke(
      event => handleUpdateContestDraft(event, contestId, deps),
      { practice_enabled: true, reason: 'Enable post-contest practice' },
      { method: 'PATCH' },
    )
    expect(missing.status).toBe(428)
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: 'resource.precondition_required', fields: { if_match: expect.any(Array) } },
    })

    const updated = await invoke(
      event => handleUpdateContestDraft(event, contestId, deps),
      { practice_enabled: true, reason: 'Enable post-contest practice' },
      { method: 'PATCH', headers: { 'if-match': '"1"' } },
    )
    expect(updated.status).toBe(200)
    expect(updated.headers.get('etag')).toBe('"2"')
    expect(deps.contests.updateDraft).toHaveBeenCalledWith(organizer, expect.objectContaining({
      contestId, expectedVersion: 1, practiceEnabled: true,
    }))
  })

  it('rejects a mode discriminator on updates before invoking the domain service', async () => {
    const deps = dependencies()
    const response = await invoke(
      event => handleUpdateContestDraft(event, contestId, deps),
      { mode: 'awd', reason: 'Attempt unsupported mode change' },
      { method: 'PATCH', headers: { 'if-match': '"1"' } },
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'contest.mode_unsupported', fields: { mode: expect.any(Array) } },
    })
    expect(deps.contests.updateDraft).not.toHaveBeenCalled()
  })

  it('projects lifecycle transitions and request audit context', async () => {
    const deps = dependencies()
    const published = await invoke(event => handlePublishContest(event, contestId, deps), { reason: 'Open scheduled contest' })
    expect(published.status).toBe(200)
    expect(deps.contests.publish).toHaveBeenCalledWith(organizer, { requestId, contestId, reason: 'Open scheduled contest' })
    const archived = await invoke(event => handleArchiveContest(event, contestId, deps), { reason: 'Archive completed contest' })
    expect(archived.status).toBe(200)
  })

  it('returns structured publication issues that locate the affected resource', async () => {
    const challengeId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f31'
    const deps = dependencies(organizer, {
      checkPublication: vi.fn(async () => ({
        ready: false,
        issues: [{
          code: 'challenge.instance_policy_invalid' as const,
          message: '动态实例缺少运行镜像',
          resourceType: 'challenge' as const,
          resourceId: challengeId,
          resourceTitle: 'Dynamic Web',
          field: `challenges.${challengeId}.instance_policy.image`,
        }],
      })),
    })
    const response = await invoke(event => handleContestPublicationCheck(event, contestId, deps))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ready: false,
      issues: [{
        code: 'challenge.instance_policy_invalid',
        message: '动态实例缺少运行镜像',
        resource_type: 'challenge',
        resource_id: challengeId,
        resource_title: 'Dynamic Web',
        field: `challenges.${challengeId}.instance_policy.image`,
      }],
    })
    expect(deps.contests.checkPublication).toHaveBeenCalledWith(organizer, contestId)
  })

  it('maps failed publication preflight to conflict with field details', async () => {
    const field = `challenges.${contestId}.flag_policy.digest`
    const deps = dependencies(organizer, {
      publish: vi.fn(async () => {
        throw new ContestServiceError('contest.publication_check_failed', {
          [field]: ['静态 Flag 策略缺少答案摘要'],
        })
      }),
    })
    const response = await invoke(
      event => handlePublishContest(event, contestId, deps),
      { reason: 'Attempt incomplete publication' },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'contest.publication_check_failed',
        fields: { [field]: ['静态 Flag 策略缺少答案摘要'] },
      },
    })
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
