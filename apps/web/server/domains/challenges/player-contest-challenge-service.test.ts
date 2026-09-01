import { describe, expect, it, vi } from 'vitest'
import type { SessionSubject } from '../identity/repository'
import type {
  ContestChallengeRepository,
  PlayerContestChallengeContext,
  PlayerContestChallengeRecord,
} from './contest-challenge-repository'
import { ContestChallengeService } from './contest-challenge-service'

const now = new Date('2026-09-02T01:00:00.000Z')
const user: SessionSubject = {
  userId: '018f47a2-4ef8-7e2c-9c24-6d68b7451f80',
  username: 'player',
  email: 'player@example.test',
  emailVerified: true,
  status: 'active',
  role: 'user',
  sessionVersion: 1,
  mustChangePassword: false,
}
const challenge: PlayerContestChallengeRecord = {
  id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f81',
  contestId: '018f47a2-4ef8-7e2c-9c24-6d68b7451f82',
  snapshotRevision: 3,
  title: 'Projection challenge',
  category: 'web',
  description: 'Protected statement',
  flagFormat: 'flag{...}',
  instanceType: 'dynamic',
  assets: [{
    id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f83',
    contentObjectId: '018f47a2-4ef8-7e2c-9c24-6d68b7451f84',
    displayName: 'starter.zip',
    sortOrder: 0,
  }],
  hints: [{
    id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f85',
    title: 'Immediate hint',
    content: 'Visible with the challenge',
    releaseAt: null,
    sortOrder: 0,
  }, {
    id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f86',
    title: 'Released hint',
    content: 'Already visible',
    releaseAt: new Date('2026-09-02T00:30:00.000Z'),
    sortOrder: 1,
  }, {
    id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f87',
    title: 'Future hint',
    content: 'Must remain hidden',
    releaseAt: new Date('2026-09-02T01:30:00.000Z'),
    sortOrder: 2,
  }],
  publishAt: new Date('2026-09-02T00:00:00.000Z'),
  closeAt: new Date('2026-09-02T02:00:00.000Z'),
  submissionLimit: 100,
  sortOrder: 0,
  version: 4,
}

function repository(context: PlayerContestChallengeContext): ContestChallengeRepository {
  return {
    mount: vi.fn(async () => { throw new Error('not used') }),
    read: vi.fn(async () => { throw new Error('not used') }),
    revise: vi.fn(async () => { throw new Error('not used') }),
    listForPlayer: vi.fn(async () => ({ context, challenges: [challenge] })),
    readForPlayer: vi.fn(async () => ({ context, challenge })),
  }
}

describe('player contest challenge projections', () => {
  it.each([
    [{ contestPhase: 'running', participationStatus: 'pending' }, challenge],
    [{ contestPhase: 'running', participationStatus: null }, challenge],
    [{ contestPhase: 'upcoming', participationStatus: 'accepted' }, challenge],
    [{ contestPhase: 'running', participationStatus: 'accepted' }, {
      ...challenge,
      publishAt: new Date('2026-09-02T01:30:00.000Z'),
    }],
  ] as const)('locks protected content when participation, phase, or publication is ineligible', async (context, record) => {
    const source = repository(context)
    source.readForPlayer = vi.fn(async () => ({ context, challenge: record }))
    const service = new ContestChallengeService(source, () => now)
    const result = await service.readForPlayer(user, challenge.contestId, challenge.id)
    expect(result).toMatchObject({ state: 'locked', content: null })
  })

  it('returns released content and only released hints to an accepted running participant', async () => {
    const source = repository({ contestPhase: 'running', participationStatus: 'accepted' })
    const service = new ContestChallengeService(source, () => now)
    const result = await service.readForPlayer(user, challenge.contestId, challenge.id)
    expect(result).toMatchObject({
      state: 'open',
      content: {
        description: 'Protected statement',
        flagFormat: 'flag{...}',
        instanceType: 'dynamic',
        assets: [{ id: challenge.assets[0]!.id, displayName: 'starter.zip' }],
        hints: [
          { title: 'Immediate hint' },
          { title: 'Released hint' },
        ],
      },
    })
    expect(result.content).not.toHaveProperty('flagPolicy')
    expect(result.content).not.toHaveProperty('contentObjectId')
    expect(result.content?.hints).toHaveLength(2)
  })

  it('keeps released content readable but marks ended contests and elapsed challenge windows closed', async () => {
    const ended = new ContestChallengeService(repository({
      contestPhase: 'ended',
      participationStatus: 'accepted',
    }), () => now)
    await expect(ended.readForPlayer(user, challenge.contestId, challenge.id)).resolves.toMatchObject({
      state: 'closed',
      content: { description: 'Protected statement' },
    })

    const elapsedSource = repository({ contestPhase: 'running', participationStatus: 'accepted' })
    const elapsedContext: PlayerContestChallengeContext = {
      contestPhase: 'running',
      participationStatus: 'accepted',
    }
    elapsedSource.readForPlayer = vi.fn(async () => ({
      context: elapsedContext,
      challenge: { ...challenge, closeAt: new Date('2026-09-02T00:59:59.000Z') },
    }))
    const elapsed = new ContestChallengeService(elapsedSource, () => now)
    await expect(elapsed.readForPlayer(user, challenge.contestId, challenge.id)).resolves.toMatchObject({
      state: 'closed',
    })
  })
})
