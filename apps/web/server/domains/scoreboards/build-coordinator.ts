export class ScoreboardBuildCoordinator {
  private readonly inFlight = new Map<string, Promise<unknown>>()

  async run<T>(
    key: string,
    build: () => Promise<T>,
  ): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined
    if (existing) return existing
    const coordinated = build()
    this.inFlight.set(key, coordinated)
    try {
      return await coordinated
    }
    finally {
      if (this.inFlight.get(key) === coordinated) this.inFlight.delete(key)
    }
  }

}
