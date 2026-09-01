import { randomUUID } from 'node:crypto'

export type ScoreboardBuildLockResult = 'acquired' | 'contended' | 'unavailable'

export interface ScoreboardBuildLock {
  acquire(key: string, owner: string, ttlMs: number): Promise<ScoreboardBuildLockResult>
  release(key: string, owner: string): Promise<void>
}

export type ScoreboardBuildMode = 'leader' | 'lock_unavailable' | 'contention_timeout'

export class ScoreboardBuildCoordinator {
  private readonly inFlight = new Map<string, Promise<unknown>>()

  constructor(
    private readonly lock?: ScoreboardBuildLock,
    private readonly lockTtlMs = 5_000,
    private readonly waitMs = 750,
    private readonly pollMs = 50,
    private readonly sleep: (milliseconds: number) => Promise<void> = delay,
    private readonly now: () => number = Date.now,
  ) {}

  async run<T>(
    key: string,
    waitForWinner: () => Promise<T | null>,
    build: (mode: ScoreboardBuildMode) => Promise<T>,
  ): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined
    if (existing) return existing
    const coordinated = this.coordinate(key, waitForWinner, build)
    this.inFlight.set(key, coordinated)
    try {
      return await coordinated
    }
    finally {
      if (this.inFlight.get(key) === coordinated) this.inFlight.delete(key)
    }
  }

  private async coordinate<T>(
    key: string,
    waitForWinner: () => Promise<T | null>,
    build: (mode: ScoreboardBuildMode) => Promise<T>,
  ): Promise<T> {
    const owner = randomUUID()
    let lockResult: ScoreboardBuildLockResult = 'unavailable'
    try {
      lockResult = this.lock
        ? await this.lock.acquire(key, owner, this.lockTtlMs)
        : 'unavailable'
    }
    catch {
      lockResult = 'unavailable'
    }
    if (lockResult === 'contended') {
      const deadline = this.now() + this.waitMs
      while (true) {
        const value = await waitForWinner()
        if (value) return value
        const remaining = deadline - this.now()
        if (remaining <= 0) return build('contention_timeout')
        await this.sleep(Math.min(this.pollMs, remaining))
      }
    }
    try {
      return await build(lockResult === 'acquired' ? 'leader' : 'lock_unavailable')
    }
    finally {
      if (lockResult === 'acquired') {
        try {
          await this.lock?.release(key, owner)
        }
        catch {
          // The lock is only load coordination and expires independently.
        }
      }
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
