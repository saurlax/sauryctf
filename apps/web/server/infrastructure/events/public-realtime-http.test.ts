import { createApp, eventHandler, setResponseStatus, toWebHandler, type H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import type { PublicRealtimeEvent, PublicRealtimeLog } from '../../domains/events/public-realtime'
import { ContestServiceError } from '../../domains/contests/service'
import { normalizeApiError } from '../http/errors'
import {
  handlePublicContestEvents,
  type PublicRealtimeHttpDependencies,
} from './public-realtime-http'

const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c'
const contestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2e'
const firstId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f30'
const secondId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f31'

const contest = {
  id: contestId, title: 'Autumn CTF', slug: 'autumn-ctf', description: 'Contest',
  publicationStatus: 'published' as const, phase: 'running' as const, visibility: 'public' as const,
  inviteRequired: false, inviteConfigured: false, registrationStrategy: 'review' as const,
  startAt: new Date('2026-09-01T00:00:00.000Z'), endAt: new Date('2026-09-01T12:00:00.000Z'),
  scoreboardFreezeAt: null, practiceEnabled: false, writeupRequired: false,
  writeupDeadlineAt: null, minTeamSize: 1, maxTeamSize: 5,
  registrationConstraints: { allowedEmailDomains: [] },
  publishedAt: new Date('2026-08-01T00:00:00.000Z'), archivedAt: null, version: 2,
}

function refresh(id: string, version: number): PublicRealtimeEvent {
  return {
    schema: 'public-realtime-event.v1', id, contestId,
    type: 'scoreboard.refresh', version, occurredAt: '2026-09-01T08:00:00.000Z',
  }
}

function dependencies(
  realtime: PublicRealtimeLog,
  readPublic = vi.fn(async () => contest),
): PublicRealtimeHttpDependencies {
  return {
    contests: { readPublic },
    realtime,
  }
}

async function invoke(
  dependencies: PublicRealtimeHttpDependencies,
  lastEventId?: string,
) {
  const messages: Array<{ id?: string, event?: string, data: string }> = []
  let closed: (() => unknown) | undefined
  const stream = {
    push: vi.fn(async (message: { id?: string, event?: string, data: string }) => {
      messages.push(message)
    }),
    onClosed: vi.fn((callback: () => unknown) => { closed = callback }),
    send: vi.fn(async () => { await closed?.() }),
  }
  const app = createApp()
  app.use(eventHandler(async (event: H3Event) => {
    event.context.requestId = requestId
    try {
      return await handlePublicContestEvents(
        event,
        contestId,
        dependencies,
        stream,
      )
    }
    catch (error) {
      const response = normalizeApiError(error, requestId)
      setResponseStatus(event, response.statusCode)
      return response.body
    }
  }))
  const response = await toWebHandler(app)(new Request(`https://ctf.example.test/api/contests/${contestId}/events`, {
    headers: lastEventId ? { 'last-event-id': lastEventId } : undefined,
  }))
  return { response, messages, stream }
}

describe('public contest SSE adapter', () => {
  it('replays after Last-Event-ID, queues concurrent live events, and deduplicates stable ids', async () => {
    const unsubscribe = vi.fn(async () => {})
    const recovered = refresh(firstId, 2)
    const concurrent = refresh(secondId, 3)
    const realtime: PublicRealtimeLog = {
      subscribe: vi.fn(async (_contestId, listener) => {
        await listener(concurrent)
        return unsubscribe
      }),
      recover: vi.fn(async () => ({ status: 'recovered' as const, events: [recovered, concurrent] })),
    }
    const request = await invoke(dependencies(realtime), '018f47a2-4ef8-7e2c-9c24-6d68b7451f32')
    expect(request.messages.map(message => message.id)).toEqual([firstId, secondId])
    expect(request.messages.every(message => message.event === 'scoreboard.refresh')).toBe(true)
    expect(JSON.stringify(request.messages)).not.toContain('domain-event.v1')
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('emits reset when Last-Event-ID is outside the recovery window', async () => {
    const realtime: PublicRealtimeLog = {
      subscribe: vi.fn(async () => async () => {}),
      recover: vi.fn(async () => ({ status: 'reset' as const })),
    }
    const request = await invoke(dependencies(realtime), firstId)
    expect(request.messages).toEqual([{
      event: 'reset',
      data: JSON.stringify({ reason: 'recovery_window_unavailable' }),
    }])
  })

  it('rejects malformed cursors and contests that are not publicly readable before subscribing', async () => {
    const realtime: PublicRealtimeLog = {
      subscribe: vi.fn(async () => async () => {}),
      recover: vi.fn(async () => ({ status: 'recovered' as const, events: [] })),
    }
    const malformed = await invoke(dependencies(realtime), 'not-a-uuid')
    expect(malformed.response.status).toBe(400)
    expect(realtime.subscribe).not.toHaveBeenCalled()

    const hidden = dependencies(realtime, vi.fn(async () => {
      throw new ContestServiceError('contest.not_found')
    }))
    const denied = await invoke(hidden)
    expect(denied.response.status).toBe(404)
    expect(realtime.subscribe).not.toHaveBeenCalled()
  })
})
