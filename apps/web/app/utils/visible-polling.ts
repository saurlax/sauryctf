export interface VisiblePollingEnvironment {
  visibilityState(): DocumentVisibilityState
  addVisibilityListener(listener: () => void): void
  removeVisibilityListener(listener: () => void): void
  setInterval(callback: () => void, intervalMs: number): ReturnType<typeof setInterval>
  clearInterval(timer: ReturnType<typeof setInterval>): void
}

export interface VisiblePollingOptions {
  task: () => Promise<unknown> | unknown
  enabled: () => boolean
  intervalMs?: number
}

export function createVisiblePolling(
  options: VisiblePollingOptions,
  environment: VisiblePollingEnvironment = browserPollingEnvironment(),
) {
  const intervalMs = options.intervalMs ?? 4_000
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 3_000 || intervalMs > 5_000) {
    throw new RangeError('Visible polling interval must be between 3 and 5 seconds')
  }

  let mounted = false
  let timer: ReturnType<typeof setInterval> | undefined
  let running = false

  const tick = async () => {
    if (running || !mounted || environment.visibilityState() !== 'visible' || !options.enabled()) return
    running = true
    try {
      await options.task()
    }
    finally {
      running = false
    }
  }

  const stopTimer = () => {
    if (timer === undefined) return
    environment.clearInterval(timer)
    timer = undefined
  }

  const sync = () => {
    if (!mounted || environment.visibilityState() !== 'visible' || !options.enabled()) {
      stopTimer()
      return
    }
    if (timer === undefined) timer = environment.setInterval(() => void tick(), intervalMs)
  }

  const start = () => {
    if (mounted) return
    mounted = true
    environment.addVisibilityListener(sync)
    sync()
  }

  const stop = () => {
    if (!mounted) return
    mounted = false
    stopTimer()
    environment.removeVisibilityListener(sync)
  }

  return { start, sync, stop }
}

function browserPollingEnvironment(): VisiblePollingEnvironment {
  return {
    visibilityState: () => document.visibilityState,
    addVisibilityListener: listener => document.addEventListener('visibilitychange', listener),
    removeVisibilityListener: listener => document.removeEventListener('visibilitychange', listener),
    setInterval: (callback, intervalMs) => globalThis.setInterval(callback, intervalMs),
    clearInterval: timer => globalThis.clearInterval(timer),
  }
}
