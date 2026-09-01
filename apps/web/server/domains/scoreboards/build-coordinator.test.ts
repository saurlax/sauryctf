import { describe, expect, it, vi } from 'vitest'
import {
  ScoreboardBuildCoordinator,
  type ScoreboardBuildLock,
} from './build-coordinator'

describe('scoreboard build coordinator', () => {
  it('shares one in-process build among concurrent callers', async () => {
    const build = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      return { version: 4 }
    })
    const coordinator = new ScoreboardBuildCoordinator()
    const results = await Promise.all(Array.from({ length: 30 }, () => coordinator.run(
      'contest:public:overall:4',
      async () => null,
      build,
    )))
    expect(build).toHaveBeenCalledOnce()
    expect(results).toEqual(Array.from({ length: 30 }, () => ({ version: 4 })))
  })

  it('releases an acquired short lock with its fencing owner', async () => {
    const lock: ScoreboardBuildLock = {
      acquire: vi.fn(async () => 'acquired' as const),
      release: vi.fn(async () => {}),
    }
    const coordinator = new ScoreboardBuildCoordinator(lock)
    await expect(coordinator.run('key', async () => null, async mode => mode))
      .resolves.toBe('leader')
    expect(lock.acquire).toHaveBeenCalledWith('key', expect.any(String), 5_000)
    const owner = vi.mocked(lock.acquire).mock.calls[0]![1]
    expect(lock.release).toHaveBeenCalledWith('key', owner)
  })

  it('waits for the lock owner result and does not rebuild on contention', async () => {
    let checks = 0
    let clock = 0
    const lock: ScoreboardBuildLock = {
      acquire: vi.fn(async () => 'contended' as const),
      release: vi.fn(async () => {}),
    }
    const build = vi.fn(async () => ({ source: 'build' }))
    const coordinator = new ScoreboardBuildCoordinator(
      lock,
      5_000,
      100,
      10,
      async milliseconds => { clock += milliseconds },
      () => clock,
    )
    await expect(coordinator.run(
      'key',
      async () => ++checks === 3 ? { source: 'winner' } : null,
      build,
    )).resolves.toEqual({ source: 'winner' })
    expect(build).not.toHaveBeenCalled()
    expect(lock.release).not.toHaveBeenCalled()
  })

  it('continues in degraded mode when the short lock fails', async () => {
    const coordinator = new ScoreboardBuildCoordinator({
      acquire: vi.fn(async () => { throw new Error('redis down') }),
      release: vi.fn(async () => { throw new Error('redis down') }),
    })
    await expect(coordinator.run('key', async () => null, async mode => mode))
      .resolves.toBe('lock_unavailable')
  })
})
