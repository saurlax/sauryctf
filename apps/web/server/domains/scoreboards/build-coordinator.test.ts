import { describe, expect, it, vi } from 'vitest'
import { ScoreboardBuildCoordinator } from './build-coordinator'

describe('scoreboard build coordinator', () => {
  it('shares one in-process build among concurrent callers', async () => {
    const build = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      return { version: 4 }
    })
    const coordinator = new ScoreboardBuildCoordinator()
    const results = await Promise.all(Array.from({ length: 30 }, () => coordinator.run(
      'contest:public:overall:4',
      build,
    )))

    expect(build).toHaveBeenCalledOnce()
    expect(results).toEqual(Array.from({ length: 30 }, () => ({ version: 4 })))
  })

  it('does not merge builds for different snapshot keys', async () => {
    const coordinator = new ScoreboardBuildCoordinator()
    const first = vi.fn(async () => ({ version: 1 }))
    const second = vi.fn(async () => ({ version: 2 }))

    await expect(Promise.all([
      coordinator.run('contest:public:overall:1', first),
      coordinator.run('contest:public:overall:2', second),
    ])).resolves.toEqual([{ version: 1 }, { version: 2 }])
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })

  it('clears a failed in-flight build so a later request can retry', async () => {
    const coordinator = new ScoreboardBuildCoordinator()
    const failure = new Error('database overloaded')

    await expect(coordinator.run('key', async () => { throw failure })).rejects.toBe(failure)
    await expect(coordinator.run('key', async () => ({ version: 5 })))
      .resolves.toEqual({ version: 5 })
  })
})
