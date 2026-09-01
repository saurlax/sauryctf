import { describe, expect, it, vi } from 'vitest'
import { IdentityCapabilityError } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'
import {
  InstanceRenewalTooEarlyError,
  type InstanceRecord,
  type InstanceRepository,
} from './repository'
import { InstanceService, InstanceServiceError } from './service'

const at = new Date('2026-09-01T08:00:00.000Z')
const actor: SessionSubject = {
  userId: '018f47a2-4ef8-7e2c-9c24-6d68b7451f70',
  username: 'Player',
  email: 'player@example.test',
  emailVerified: true,
  status: 'active',
  role: 'user',
  sessionVersion: 1,
  mustChangePassword: false,
}
const contestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f71'
const challengeId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f72'
const policy = {
  initialDurationMs: 60 * 60_000,
  extensionDurationMs: 30 * 60_000,
  renewalWindowMs: 10 * 60_000,
  teamActiveLimit: 1,
}

function running(overrides: Partial<InstanceRecord> = {}): InstanceRecord {
  return {
    id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f73',
    contestId,
    contestChallengeId: challengeId,
    participationId: '018f47a2-4ef8-7e2c-9c24-6d68b7451f74',
    provider: 'docker',
    desiredState: 'running',
    desiredGeneration: 2,
    observedState: 'running',
    observedGeneration: 2,
    expiresAt: new Date(at.getTime() + 5 * 60_000),
    entrypoints: [{
      name: 'main',
      protocol: 'http',
      host: 'challenge.example.test',
      port: 443,
      url: 'https://challenge.example.test/',
    }],
    lastObservedAt: at,
    lastErrorCode: null,
    lastErrorSummary: null,
    version: 4,
    ...overrides,
  }
}

function repository(overrides: Partial<InstanceRepository> = {}): InstanceRepository {
  const record = running()
  return {
    read: vi.fn(async () => record),
    start: vi.fn(async () => record),
    renew: vi.fn(async () => ({ ...record, desiredGeneration: 3, version: 5 })),
    destroy: vi.fn(async () => ({
      ...record,
      desiredState: 'stopped' as const,
      desiredGeneration: 3,
      observedState: 'stopping' as const,
      version: 5,
    })),
    ...overrides,
  }
}

describe('instance control-plane service', () => {
  it('returns entrypoints only for a ready observation of the current generation', async () => {
    const readyService = new InstanceService(repository(), policy, () => at)
    await expect(readyService.read(actor, contestId, challengeId)).resolves.toMatchObject({
      instance: {
        state: 'running',
        can_renew: true,
        entrypoints: [{ url: 'https://challenge.example.test/' }],
      },
      policy: {
        initial_duration_seconds: 3600,
        extension_duration_seconds: 1800,
        renewal_window_seconds: 600,
        team_active_limit: 1,
      },
    })

    const staleService = new InstanceService(repository({
      read: vi.fn(async () => running({ desiredGeneration: 3, observedGeneration: 2 })),
    }), policy, () => at)
    await expect(staleService.read(actor, contestId, challengeId)).resolves.toMatchObject({
      instance: { state: 'pending', can_renew: false, entrypoints: [] },
    })
  })

  it('maps the authoritative renewal boundary without leaking internal configuration', async () => {
    const renewableAt = new Date(at.getTime() + 20 * 60_000)
    const service = new InstanceService(repository({
      renew: vi.fn(async () => { throw new InstanceRenewalTooEarlyError(renewableAt) }),
    }), policy, () => at)

    await expect(service.renew(actor, {
      requestId: '018f47a2-4ef8-7e2c-9c24-6d68b7451f75',
      contestId,
      challengeId,
    })).rejects.toEqual(new InstanceServiceError('instance.renewal_too_early', {
      renewable_at: [renewableAt.toISOString()],
    }))
  })

  it('blocks an unverified user before accessing the instance repository', async () => {
    const store = repository()
    const service = new InstanceService(store, policy, () => at)
    await expect(service.start({ ...actor, emailVerified: false }, {
      requestId: '018f47a2-4ef8-7e2c-9c24-6d68b7451f75',
      contestId,
      challengeId,
    })).rejects.toBeInstanceOf(IdentityCapabilityError)
    expect(store.start).not.toHaveBeenCalled()
  })
})
