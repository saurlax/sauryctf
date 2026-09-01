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
import { TeamServiceError } from '../../domains/teams/service'
import { DisabledHumanVerificationProvider } from '../../domains/identity/human-verification'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from '../security/rate-limit'
import {
  handleCreateTeam,
  handleCorrectTeamMembership,
  handleJoinTeam,
  handleRemoveMember,
  handleRotateInvite,
  handleTransferCaptain,
  type TeamHttpDependencies,
} from './team-http'

const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c'
const userId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2d'
const targetUserId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2e'
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
const teamRecord = {
  id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f30',
  name: 'Blue Team',
  version: 1,
  members: [{
    userId,
    username: 'Player',
    role: 'captain' as const,
    joinedAt: new Date('2026-09-01T07:10:00.000Z'),
  }],
  locks: [],
}

type TeamHandler = (event: H3Event, dependencies: TeamHttpDependencies) => Promise<unknown>

function createDependencies(
  subject: SessionSubject = verifiedSubject,
  overrides: Partial<TeamHttpDependencies['teams']> = {},
): TeamHttpDependencies {
  return {
    identity: {
      identity: {} as TeamHttpDependencies['identity']['identity'],
      sessions: { validate: vi.fn(async () => subject) },
      humanVerification: new DisabledHumanVerificationProvider(),
      rateLimits: new MemoryRateLimitStore(),
      browserSession: {
        read: vi.fn(async () => session),
        replace: vi.fn(async () => undefined),
        clear: vi.fn(async () => undefined),
      },
    },
    teams: {
      create: vi.fn(async () => ({ team: teamRecord, inviteCode: 'i'.repeat(43) })),
      current: vi.fn(async () => teamRecord),
      join: vi.fn(async () => teamRecord),
      leave: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      rotateInvite: vi.fn(async () => 'r'.repeat(43)),
      transfer: vi.fn(async () => undefined),
      correctMembership: vi.fn(async () => teamRecord),
      ...overrides,
    },
  }
}

async function invoke(
  handler: TeamHandler,
  dependencies: TeamHttpDependencies,
  body: unknown = {},
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
  return toWebHandler(app)(new Request('https://ctf.example.test/api/teams/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

describe('team HTTP adapters', () => {
  it('rejects team writes for an unverified identity before the domain command runs', async () => {
    const dependencies = createDependencies({ ...verifiedSubject, emailVerified: false })
    const response = await invoke(handleCreateTeam, dependencies, { name: 'Blue Team' })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'identity.email_verification_required' },
    })
    expect(dependencies.teams.create).not.toHaveBeenCalled()
  })

  it.each([
    ['remove a member', (event: H3Event, dependencies: TeamHttpDependencies) => handleRemoveMember(event, targetUserId, dependencies)],
    ['rotate the invite', (event: H3Event, dependencies: TeamHttpDependencies) => handleRotateInvite(event, dependencies)],
    ['transfer the captain', (event: H3Event, dependencies: TeamHttpDependencies) => handleTransferCaptain(event, dependencies)],
  ] as const)('maps a non-captain attempt to %s to the stable forbidden error', async (_label, handler) => {
    const forbidden = vi.fn(async () => { throw new TeamServiceError('team.forbidden') })
    const dependencies = createDependencies(verifiedSubject, {
      remove: forbidden,
      rotateInvite: forbidden,
      transfer: forbidden,
    })
    const response = await invoke(handler, dependencies, { user_id: targetUserId })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'team.forbidden' },
    })
  })

  it('returns the same public result for unknown and revoked invite codes', async () => {
    const dependencies = createDependencies(verifiedSubject, {
      join: vi.fn(async () => { throw new TeamServiceError('team.invite_invalid') }),
    })
    const unknown = await invoke(handleJoinTeam, dependencies, { invite_code: 'u'.repeat(43) })
    const revoked = await invoke(handleJoinTeam, dependencies, { invite_code: 'r'.repeat(43) })

    expect(unknown.status).toBe(400)
    expect(revoked.status).toBe(400)
    expect(await unknown.json()).toEqual(await revoked.json())
  })

  it('creates a team with a one-time invite response', async () => {
    const dependencies = createDependencies()
    const response = await invoke(handleCreateTeam, dependencies, { name: 'Blue Team' })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      team: {
        id: teamRecord.id,
        invite_code: 'i'.repeat(43),
      },
    })
  })

  it('allows only an admin to submit a confirmed membership correction with a reason', async () => {
    const organizerDependencies = createDependencies({ ...verifiedSubject, role: 'organizer' })
    const handler: TeamHandler = (event, dependencies) => handleCorrectTeamMembership(
      event,
      teamRecord.id,
      dependencies,
    )
    const input = {
      operation: 'remove_member',
      user_id: targetUserId,
      reason: 'Remove an ineligible registered member',
      confirm: true,
    }
    const forbidden = await invoke(handler, organizerDependencies, input)

    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toMatchObject({
      error: { code: 'identity.capability_forbidden' },
    })
    expect(organizerDependencies.teams.correctMembership).not.toHaveBeenCalled()

    const adminDependencies = createDependencies({ ...verifiedSubject, role: 'admin' })
    const unconfirmed = await invoke(handler, adminDependencies, { ...input, confirm: false })
    expect(unconfirmed.status).toBe(400)
    expect(adminDependencies.teams.correctMembership).not.toHaveBeenCalled()

    const corrected = await invoke(handler, adminDependencies, input)
    expect(corrected.status).toBe(200)
    expect(adminDependencies.teams.correctMembership).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin' }),
      {
        requestId,
        teamId: teamRecord.id,
        operation: 'remove_member',
        targetUserId,
        reason: input.reason,
      },
    )
  })
})
