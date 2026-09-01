import { createClient } from 'redis'
import {
  scoreboardVersionChange,
  serializeDomainEvent,
  type DomainEvent,
  type DomainEventPublisher,
  type DomainEventPublishResult,
} from '../../domains/events/domain-outbox'
import { publicRealtimeEventSchema } from '../../domains/events/public-realtime'

export const domainEventChannel = 'sauryctf:domain-events:domain-event.v1'
const dedupeTtlSeconds = 7 * 24 * 60 * 60
const realtimeWindowSeconds = 24 * 60 * 60
const realtimeWindowSize = 1_000

const publishScript = `
local inserted = redis.call('SET', KEYS[1], '1', 'EX', ARGV[1], 'NX')
if not inserted then
  return 0
end
redis.call('PUBLISH', ARGV[2], ARGV[3])
return 1
`

const publishScoreboardVersionScript = `
local inserted = redis.call('SET', KEYS[1], '1', 'EX', ARGV[1], 'NX')
if not inserted then
  return 0
end
local current = tonumber(redis.call('GET', KEYS[2]))
local incoming = tonumber(ARGV[4])
if not current or incoming > current then
  redis.call('SET', KEYS[2], ARGV[4])
end
redis.call('RPUSH', KEYS[3], ARGV[5])
redis.call('LTRIM', KEYS[3], -tonumber(ARGV[6]), -1)
redis.call('EXPIRE', KEYS[3], ARGV[7])
redis.call('PUBLISH', ARGV[2], ARGV[3])
redis.call('PUBLISH', ARGV[8], ARGV[5])
return 1
`

export class RedisDomainEventPublisher implements DomainEventPublisher {
  private readonly client
  private connecting: Promise<unknown> | null = null

  constructor(redisUrl?: string) {
    this.client = redisUrl ? createClient({ url: redisUrl }) : null
    this.client?.on('error', () => {})
  }

  async publish(event: DomainEvent): Promise<DomainEventPublishResult> {
    if (!this.client) throw new RedisDomainEventsUnavailableError()
    const message = serializeDomainEvent(event)
    const versionChange = scoreboardVersionChange(event)
    const publicMessage = versionChange
      ? JSON.stringify(publicRealtimeEventSchema.parse({
          schema: 'public-realtime-event.v1',
          id: event.id,
          contestId: versionChange.contestId,
          type: 'scoreboard.refresh',
          version: versionChange.version,
          occurredAt: event.occurredAt,
        }))
      : null
    await this.ensureConnected()
    const result = versionChange
      ? await this.client.eval(publishScoreboardVersionScript, {
          keys: [
            domainEventDedupeKey(event.id),
            scoreboardVersionKey(versionChange.contestId),
            contestRealtimeLogKey(versionChange.contestId),
          ],
          arguments: [
            String(dedupeTtlSeconds),
            domainEventChannel,
            message,
            String(versionChange.version),
            publicMessage!,
            String(realtimeWindowSize),
            String(realtimeWindowSeconds),
            contestRealtimeChannel(versionChange.contestId),
          ],
        })
      : await this.client.eval(publishScript, {
          keys: [domainEventDedupeKey(event.id)],
          arguments: [String(dedupeTtlSeconds), domainEventChannel, message],
        })
    return Number(result) === 1 ? 'published' : 'duplicate'
  }

  async close(): Promise<void> {
    if (this.client?.isOpen) this.client.destroy()
  }

  private async ensureConnected(): Promise<void> {
    if (!this.client || this.client.isReady) return
    this.connecting ??= this.client.connect().finally(() => { this.connecting = null })
    await this.connecting
  }
}

export class RedisDomainEventsUnavailableError extends Error {
  constructor() {
    super('Redis domain event publishing is unavailable')
    this.name = 'RedisDomainEventsUnavailableError'
  }
}

export function domainEventDedupeKey(eventId: string): string {
  return `sauryctf:domain-event:domain-event.v1:id=${encodeURIComponent(eventId)}`
}

export function scoreboardVersionKey(contestId: string): string {
  return `sauryctf:scoreboard-version:scoreboard-cache.v1:contest=${encodeURIComponent(contestId)}`
}

export function contestRealtimeLogKey(contestId: string): string {
  return `sauryctf:contest-realtime:public-realtime-event.v1:contest=${encodeURIComponent(contestId)}`
}

export function contestRealtimeChannel(contestId: string): string {
  return `${domainEventChannel}:contest=${encodeURIComponent(contestId)}`
}
