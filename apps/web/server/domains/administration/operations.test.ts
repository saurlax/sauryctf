import { describe, expect, it, vi } from 'vitest'
import type { OperationalCommand, OperationalCommandKind } from '../../../shared/contracts/operations'
import type { SessionSubject } from '../identity/repository'
import {
  AdministrationOperationsService,
  OperationalCacheUnavailableError,
  type OperationalCommandRepository,
  type OperationalScoreboardCache,
  type OperationalScoreboardService,
} from './operations'

const at = new Date('2026-09-02T00:00:00.000Z')
const actorId = '018f47a2-4ef8-7e2c-9c24-000000000601'
const contestId = '018f47a2-4ef8-7e2c-9c24-000000000602'
const divisionId = '018f47a2-4ef8-7e2c-9c24-000000000603'
const admin: SessionSubject = {
  userId: actorId,
  username: 'Operator',
  email: 'operator@example.test',
  emailVerified: true,
  status: 'active',
  role: 'admin',
  sessionVersion: 1,
  mustChangePassword: false,
}

function completed(kind: OperationalCommandKind, targetId = contestId, replayed = false): OperationalCommand {
  return {
    id: '018f47a2-4ef8-7e2c-9c24-000000000604',
    kind,
    target_id: targetId,
    status: 'succeeded',
    replayed,
    completed_at: at.toISOString(),
    result: { target_id: targetId },
  }
}

function dependencies() {
  const repository: OperationalCommandRepository = {
    executeDatabase: vi.fn(async command => completed(command.kind, command.targetId)),
    reserveExternal: vi.fn(async () => ({
      commandId: '018f47a2-4ef8-7e2c-9c24-000000000604',
      replayed: null,
    })),
    completeExternal: vi.fn(async (_commandId, result) => ({
      ...completed('cache_rebuild'),
      result,
    })),
    failExternal: vi.fn(async () => {}),
    scoreboardContext: vi.fn(async () => ({
      publicationStatus: 'published' as const,
      visibility: 'public' as const,
      scopes: [{ type: 'overall' as const }, { type: 'division' as const, divisionId }],
    })),
    clearScoreboardSnapshots: vi.fn(async () => 0),
  }
  const scoreboards: OperationalScoreboardService = { read: vi.fn(async () => ({})) }
  const cache: OperationalScoreboardCache = { invalidateContest: vi.fn(async () => 3) }
  return { repository, scoreboards, cache }
}

function input(kind: OperationalCommandKind, targetId = contestId) {
  return {
    requestId: 'request-operation-0001',
    idempotencyKey: `operation-${kind}-0001`,
    kind,
    targetId,
    reason: '故障确认后执行受控恢复操作',
  }
}

describe('administration operations service', () => {
  it('requires the global operations capability at the domain boundary', async () => {
    const deps = dependencies()
    const service = new AdministrationOperationsService(deps.repository, deps.scoreboards, deps.cache, () => at)

    await expect(service.execute({ ...admin, role: 'organizer' }, input('session_invalidate', actorId)))
      .rejects.toMatchObject({ code: 'identity.capability_forbidden' })
    expect(deps.repository.executeDatabase).not.toHaveBeenCalled()
  })

  it('delegates database-only commands with the authenticated actor and stable operation context', async () => {
    const deps = dependencies()
    const service = new AdministrationOperationsService(deps.repository, deps.scoreboards, deps.cache, () => at)

    await expect(service.execute(admin, input('session_invalidate', actorId)))
      .resolves.toMatchObject({ kind: 'session_invalidate', target_id: actorId })
    expect(deps.repository.executeDatabase).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      at,
      kind: 'session_invalidate',
      targetId: actorId,
    }))
  })

  it('rebuilds every internal and eligible public scope after invalidating contest cache', async () => {
    const deps = dependencies()
    const service = new AdministrationOperationsService(deps.repository, deps.scoreboards, deps.cache, () => at)

    const result = await service.execute(admin, input('cache_rebuild'))

    expect(deps.repository.clearScoreboardSnapshots).not.toHaveBeenCalled()
    expect(deps.cache.invalidateContest).toHaveBeenCalledWith(contestId)
    expect(deps.scoreboards.read).toHaveBeenCalledTimes(4)
    expect(deps.scoreboards.read).toHaveBeenNthCalledWith(1, {
      contestId, view: 'internal', viewerRole: 'admin', scope: { type: 'overall' },
    })
    expect(deps.scoreboards.read).toHaveBeenNthCalledWith(2, {
      contestId, view: 'public', viewerRole: 'admin', scope: { type: 'overall' },
    })
    expect(result.result).toMatchObject({ cache_keys_deleted: 3, projections_rebuilt: 4, snapshots_cleared: 0 })
  })

  it('clears only derived snapshots before recalculating result projections', async () => {
    const deps = dependencies()
    const events: string[] = []
    deps.repository.clearScoreboardSnapshots = vi.fn(async () => { events.push('snapshots'); return 7 })
    deps.cache.invalidateContest = vi.fn(async () => { events.push('cache'); return 2 })
    deps.scoreboards.read = vi.fn(async () => { events.push('projection'); return {} })
    deps.repository.completeExternal = vi.fn(async (_commandId, result) => ({
      ...completed('result_recalculate'), result,
    }))
    const service = new AdministrationOperationsService(deps.repository, deps.scoreboards, deps.cache, () => at)

    const result = await service.execute(admin, input('result_recalculate'))

    expect(events.slice(0, 3)).toEqual(['snapshots', 'cache', 'projection'])
    expect(result.result).toMatchObject({ snapshots_cleared: 7, cache_keys_deleted: 2, projections_rebuilt: 4 })
  })

  it('returns a completed idempotent replay without repeating external side effects', async () => {
    const deps = dependencies()
    deps.repository.reserveExternal = vi.fn(async () => ({
      commandId: '018f47a2-4ef8-7e2c-9c24-000000000604',
      replayed: completed('cache_rebuild', contestId, true),
    }))
    const service = new AdministrationOperationsService(deps.repository, deps.scoreboards, deps.cache, () => at)

    await expect(service.execute(admin, input('cache_rebuild'))).resolves.toMatchObject({ replayed: true })
    expect(deps.repository.scoreboardContext).not.toHaveBeenCalled()
    expect(deps.cache.invalidateContest).not.toHaveBeenCalled()
    expect(deps.scoreboards.read).not.toHaveBeenCalled()
    expect(deps.repository.completeExternal).not.toHaveBeenCalled()
  })

  it('records a failed command when Redis prevents an explicit rebuild', async () => {
    const deps = dependencies()
    deps.cache.invalidateContest = vi.fn(async () => { throw new OperationalCacheUnavailableError() })
    const service = new AdministrationOperationsService(deps.repository, deps.scoreboards, deps.cache, () => at)

    await expect(service.execute(admin, input('cache_rebuild')))
      .rejects.toMatchObject({ code: 'operations.cache_unavailable' })
    expect(deps.repository.failExternal).toHaveBeenCalledWith(
      '018f47a2-4ef8-7e2c-9c24-000000000604',
      'operations.cache_unavailable',
      at,
    )
    expect(deps.repository.completeExternal).not.toHaveBeenCalled()
  })
})
