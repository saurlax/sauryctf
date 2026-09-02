import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVisiblePolling, type VisiblePollingEnvironment } from './visible-polling'

function environment() {
  let visibility: DocumentVisibilityState = 'visible'
  const listeners = new Set<() => void>()
  const value: VisiblePollingEnvironment = {
    visibilityState: () => visibility,
    addVisibilityListener: listener => listeners.add(listener),
    removeVisibilityListener: listener => listeners.delete(listener),
    setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
    clearInterval: timer => clearInterval(timer),
  }
  return {
    value,
    setVisibility(next: DocumentVisibilityState) {
      visibility = next
      for (const listener of listeners) listener()
    },
    listenerCount: () => listeners.size,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('visible HTTP polling', () => {
  it('polls every four seconds only while the scoreboard is visible and active', async () => {
    vi.useFakeTimers()
    const browser = environment()
    let enabled = true
    const task = vi.fn(async () => {})
    const polling = createVisiblePolling({ task, enabled: () => enabled }, browser.value)

    polling.start()
    await vi.advanceTimersByTimeAsync(8_000)
    expect(task).toHaveBeenCalledTimes(2)

    browser.setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(8_000)
    expect(task).toHaveBeenCalledTimes(2)

    browser.setVisibility('visible')
    await vi.advanceTimersByTimeAsync(4_000)
    expect(task).toHaveBeenCalledTimes(3)

    enabled = false
    polling.sync()
    await vi.advanceTimersByTimeAsync(8_000)
    expect(task).toHaveBeenCalledTimes(3)
  })

  it('stops timers and visibility listeners when the page unmounts', async () => {
    vi.useFakeTimers()
    const browser = environment()
    const task = vi.fn(async () => {})
    const polling = createVisiblePolling({ task, enabled: () => true }, browser.value)

    polling.start()
    expect(browser.listenerCount()).toBe(1)
    polling.stop()
    expect(browser.listenerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(8_000)
    expect(task).not.toHaveBeenCalled()
  })
})
