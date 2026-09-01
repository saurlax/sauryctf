import { createApp, eventHandler, setResponseStatus, toWebHandler, type H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import type { PlayerInstanceResult } from '../../domains/instances/service'
import { InstanceServiceError } from '../../domains/instances/service'
import type { SessionSubject } from '../../domains/identity/repository'
import { DisabledHumanVerificationProvider } from '../../domains/identity/human-verification'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from '../security/rate-limit'
import type { IdentityHttpDependencies } from '../auth/identity-http'
import {
  handleRenewPlayerInstance,
  handleStartPlayerInstance,
  type InstanceHttpDependencies,
} from './instance-http'

const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f70'
const userId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f71'
const contestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f72'
const challengeId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f73'
const session: AuthSessionData = {
  user_id: userId,
  session_version: 1,
  logged_in_at: '2026-09-01T08:00:00.000Z',
}
const subject: SessionSubject = {
  userId,
  username: 'Player',
  email: 'player@example.test',
  emailVerified: true,
  status: 'active',
  role: 'user',
  sessionVersion: 1,
  mustChangePassword: false,
}
const result: PlayerInstanceResult = {
  instance: {
    id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f74',
    contest_id: contestId,
    contest_challenge_id: challengeId,
    participation_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f75',
    provider: 'docker',
    state: 'pending',
    desired_generation: 1,
    observed_generation: 0,
    expires_at: '2026-09-01T09:00:00.000Z',
    renewable_at: '2026-09-01T08:50:00.000Z',
    can_renew: false,
    entrypoints: [],
    last_observed_at: null,
    error: null,
    version: 1,
  },
  policy: {
    initial_duration_seconds: 3600,
    extension_duration_seconds: 1800,
    renewal_window_seconds: 600,
    team_active_limit: 1,
  },
}

function identity(): IdentityHttpDependencies {
  return {
    identity: {} as IdentityHttpDependencies['identity'],
    sessions: { validate: vi.fn(async () => subject) },
    humanVerification: new DisabledHumanVerificationProvider(),
    rateLimits: new MemoryRateLimitStore(),
    browserSession: {
      read: vi.fn(async () => session),
      replace: vi.fn(),
      clear: vi.fn(),
    },
  }
}

async function invoke(
  handler: (event: H3Event, contestId: string, challengeId: string, dependencies: InstanceHttpDependencies) => Promise<unknown>,
  dependencies: InstanceHttpDependencies,
) {
  const app = createApp()
  app.use(eventHandler(async (event) => {
    event.context.requestId = requestId
    try {
      return await handler(event, contestId, challengeId, dependencies)
    }
    catch (error) {
      const response = normalizeApiError(error, requestId)
      setResponseStatus(event, response.statusCode)
      return response.body
    }
  }))
  return toWebHandler(app)(new Request('https://ctf.example.test/api/instances', { method: 'POST' }))
}

describe('instance HTTP adapter', () => {
  it('returns 202 while the durable ensure command awaits a Worker observation', async () => {
    const dependencies: InstanceHttpDependencies = {
      identity: identity(),
      instances: {
        read: vi.fn(async () => result),
        start: vi.fn(async () => result),
        renew: vi.fn(async () => result),
        destroy: vi.fn(async () => result),
      },
    }
    const response = await invoke(handleStartPlayerInstance, dependencies)
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual(result)
    expect(dependencies.instances.start).toHaveBeenCalledWith(subject, {
      requestId,
      contestId,
      challengeId,
    })
  })

  it('returns the stable renewal boundary without exposing a task payload', async () => {
    const dependencies: InstanceHttpDependencies = {
      identity: identity(),
      instances: {
        read: vi.fn(async () => result),
        start: vi.fn(async () => result),
        renew: vi.fn(async () => {
          throw new InstanceServiceError('instance.renewal_too_early', {
            renewable_at: ['2026-09-01T08:50:00.000Z'],
          })
        }),
        destroy: vi.fn(async () => result),
      },
    }
    const response = await invoke(handleRenewPlayerInstance, dependencies)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'instance.renewal_too_early',
        message: '实例尚未进入续期窗口',
        request_id: requestId,
        fields: { renewable_at: ['2026-09-01T08:50:00.000Z'] },
      },
    })
  })
})
