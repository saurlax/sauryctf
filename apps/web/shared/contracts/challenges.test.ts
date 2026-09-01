import { describe, expect, it } from 'vitest'
import {
  challengeCategorySchema,
  challengeFlagPolicySchema,
  challengeInstancePolicySchema,
  challengeScoringPolicySchema,
  createChallengeTemplateRequestSchema,
  playerContestChallengeSchema,
} from './challenges'

describe('orthogonal challenge policy contracts', () => {
  it.each(['web', 'pwn', 'crypto', 'reverse', 'misc', 'forensics'] as const)(
    'accepts the Jeopardy display category %s',
    (category) => {
      expect(challengeCategorySchema.parse(category)).toBe(category)
    },
  )

  it('rejects AWD and unknown display categories', () => {
    expect(challengeCategorySchema.safeParse('awd').success).toBe(false)
    expect(challengeCategorySchema.safeParse('hardware').success).toBe(false)
  })

  it('accepts public content with a team-derived Flag and no runtime instance', () => {
    const parsed = createChallengeTemplateRequestSchema.parse({
      name: 'Derived Flag Template',
      slug: 'derived-flag-template',
      title: 'Derived Flag Challenge',
      category: 'crypto',
      description: 'A public attachment with an independently derived team Flag.',
      flag_format: 'flag{...}',
      flag_policy: { type: 'team-derived', key_version: 3 },
      scoring_policy: {
        type: 'decay-v1',
        initial_points: 500,
        minimum_points: 100,
        decay_solves: 50,
      },
      instance_policy: { type: 'none' },
      assets: [{
        content_object_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f61',
        display_name: 'public.zip',
      }],
    })
    expect(parsed).toMatchObject({
      category: 'crypto',
      flag_policy: { type: 'team-derived', key_version: 3 },
      scoring_policy: { type: 'decay-v1', minimum_points: 100 },
      instance_policy: { type: 'none' },
    })
  })

  it.each([
    ['docker', 'http'],
    ['kubernetes', 'tcp'],
  ] as const)('accepts a %s dynamic instance independently of category and Flag strategy', (provider, protocol) => {
    expect(challengeInstancePolicySchema.parse({
      type: 'dynamic',
      provider,
      image: 'registry.example.test/challenge:v1',
      entry_port: 8080,
      entry_protocol: protocol,
    })).toEqual({
      type: 'dynamic',
      provider,
      image: 'registry.example.test/challenge:v1',
      entry_port: 8080,
      entry_protocol: protocol,
    })
  })

  it('rejects unsupported, incomplete, and mixed policy shapes', () => {
    expect(challengeFlagPolicySchema.safeParse({ type: 'static' }).success).toBe(false)
    expect(challengeFlagPolicySchema.safeParse({
      type: 'team-derived', key_version: 1, digest: 'must-not-mix-strategies',
    }).success).toBe(false)
    expect(challengeScoringPolicySchema.safeParse({
      type: 'decay-v1', initial_points: 100, minimum_points: 200, decay_solves: 10,
    }).success).toBe(false)
    expect(challengeScoringPolicySchema.safeParse({ type: 'percentage-v1', points: 500 }).success).toBe(false)
    expect(challengeInstancePolicySchema.safeParse({
      type: 'dynamic', provider: 'shell', image: 'x', entry_port: 80,
    }).success).toBe(false)
    expect(challengeInstancePolicySchema.safeParse({ type: 'none', image: 'must-not-be-present' }).success).toBe(false)
  })
})

describe('player contest challenge projection contracts', () => {
  const base = {
    id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f70',
    contest_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f71',
    title: 'Player-safe challenge',
    category: 'web' as const,
    publish_at: '2026-09-02T00:00:00.000Z',
    close_at: null,
    sort_order: 0,
    snapshot_revision: 1,
    version: 1,
  }

  it('represents inaccessible protected content as an explicit locked projection', () => {
    expect(playerContestChallengeSchema.parse({
      ...base,
      state: 'locked',
      content: null,
    })).toMatchObject({ state: 'locked', content: null })
  })

  it('accepts released player content without infrastructure or Flag verification material', () => {
    expect(playerContestChallengeSchema.parse({
      ...base,
      state: 'open',
      content: {
        description: 'Inspect the response headers.',
        flag_format: 'flag{...}',
        instance_type: 'dynamic',
        submission_limit: 100,
        assets: [{
          id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f72',
          display_name: 'starter.zip',
          sort_order: 0,
        }],
        hints: [{
          id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f73',
          title: 'Headers',
          content: 'Compare cache headers.',
          released_at: null,
          sort_order: 0,
        }],
      },
    })).toMatchObject({ state: 'open', content: { instance_type: 'dynamic' } })
  })

  it.each([
    ['flag_policy', { type: 'static', digest: 'secret-digest' }],
    ['scoring_policy', { type: 'fixed-v1', points: 500 }],
    ['instance_policy', { type: 'dynamic', image: 'private/image', provider: 'kubernetes' }],
  ])('rejects leaked %s material from the player response', (field, value) => {
    expect(playerContestChallengeSchema.safeParse({
      ...base,
      state: 'locked',
      content: null,
      [field]: value,
    }).success).toBe(false)
  })
})
