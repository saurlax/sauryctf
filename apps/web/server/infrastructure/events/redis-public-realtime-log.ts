import { createClient } from 'redis'
import {
  publicRealtimeEventSchema,
  type PublicRealtimeEvent,
  type PublicRealtimeLog,
  type PublicRealtimeRecovery,
} from '../../domains/events/public-realtime'
import {
  contestRealtimeChannel,
  contestRealtimeLogKey,
} from './redis-domain-event-publisher'
import { createResilientRedisClient } from '../cache/resilient-redis-client'

export class RedisPublicRealtimeLog implements PublicRealtimeLog {
  private readonly reader
  private connecting: Promise<unknown> | null = null
  private readonly subscribers = new Set<ReturnType<typeof createClient>>()

  constructor(redisUrl?: string) {
    this.reader = createResilientRedisClient(redisUrl)
    this.reader?.on('error', () => {})
  }

  async recover(contestId: string, lastEventId: string | null): Promise<PublicRealtimeRecovery> {
    if (!this.reader) return { status: 'reset' }
    try {
      await this.ensureConnected()
      if (lastEventId === null) return { status: 'recovered', events: [] }
      const messages = await this.reader.lRange(contestRealtimeLogKey(contestId), 0, -1)
      const events = messages.map(message => publicRealtimeEventSchema.parse(JSON.parse(message)))
      const cursor = events.findIndex(event => event.id === lastEventId)
      return cursor === -1
        ? { status: 'reset' }
        : { status: 'recovered', events: events.slice(cursor + 1) }
    }
    catch {
      return { status: 'reset' }
    }
  }

  async subscribe(
    contestId: string,
    listener: (event: PublicRealtimeEvent) => void | Promise<void>,
  ): Promise<() => Promise<void>> {
    if (!this.reader) return async () => {}
    const subscriber = this.reader.duplicate()
    subscriber.on('error', () => {})
    try {
      await subscriber.connect()
      await subscriber.subscribe(contestRealtimeChannel(contestId), async (message) => {
        try {
          const realtimeEvent = publicRealtimeEventSchema.parse(JSON.parse(message))
          if (realtimeEvent.contestId === contestId) await listener(realtimeEvent)
        }
        catch {
          // Malformed or cross-contest messages are never forwarded to browsers.
        }
      })
      this.subscribers.add(subscriber)
    }
    catch {
      if (subscriber.isOpen) subscriber.destroy()
      return async () => {}
    }
    let closed = false
    return async () => {
      if (closed) return
      closed = true
      this.subscribers.delete(subscriber)
      if (subscriber.isOpen) subscriber.destroy()
    }
  }

  async close(): Promise<void> {
    for (const subscriber of this.subscribers) {
      if (subscriber.isOpen) subscriber.destroy()
    }
    this.subscribers.clear()
    if (this.reader?.isOpen) this.reader.destroy()
  }

  private async ensureConnected(): Promise<void> {
    if (!this.reader || this.reader.isReady) return
    this.connecting ??= this.reader.connect().finally(() => { this.connecting = null })
    await this.connecting
  }
}
