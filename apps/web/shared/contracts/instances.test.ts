import { describe, expect, it } from 'vitest'
import { playerInstanceResponseSchema } from './instances'

const valid = {
  instance: {
    id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f70',
    contest_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f71',
    contest_challenge_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f72',
    participation_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f73',
    provider: 'docker',
    state: 'running',
    desired_generation: 2,
    observed_generation: 2,
    expires_at: '2026-09-01T09:00:00.000Z',
    renewable_at: '2026-09-01T08:50:00.000Z',
    can_renew: false,
    entrypoints: [{
      name: 'main',
      protocol: 'http',
      host: 'challenge.example.test',
      port: 443,
      url: 'https://challenge.example.test/',
    }],
    last_observed_at: '2026-09-01T08:00:00.000Z',
    error: null,
    version: 3,
  },
  policy: {
    initial_duration_seconds: 3600,
    extension_duration_seconds: 1800,
    renewal_window_seconds: 600,
    team_active_limit: 1,
  },
}

describe('player instance contract', () => {
  it('accepts ready public entrypoints without provider credentials', () => {
    expect(playerInstanceResponseSchema.parse(valid)).toEqual(valid)
  })

  it('rejects internal access ciphertext and invalid protocol projections', () => {
    expect(playerInstanceResponseSchema.safeParse({
      ...valid,
      instance: { ...valid.instance, access_ciphertext: 'secret' },
    }).success).toBe(false)
    expect(playerInstanceResponseSchema.safeParse({
      ...valid,
      instance: {
        ...valid.instance,
        entrypoints: [{ ...valid.instance.entrypoints[0], protocol: 'tcp', url: 'https://challenge.example.test/' }],
      },
    }).success).toBe(false)
  })
})
