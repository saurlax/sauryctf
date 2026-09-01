import type { H3Event } from 'h3'
import { createEventStream, getHeader } from 'h3'
import { uuidSchema } from '../../../shared/contracts/common-types'
import type { PublicRealtimeEvent, PublicRealtimeLog } from '../../domains/events/public-realtime'
import type { ContestService } from '../../domains/contests/service'
import {
  contestHttpDependencies,
  readPublicContest,
} from '../contests/contest-http'
import { createApiError } from '../http/errors'

export interface PublicRealtimeHttpDependencies {
  contests: Pick<ContestService, 'readPublic'>
  realtime: PublicRealtimeLog
}

export interface PublicRealtimeEventStream {
  push(message: { id?: string, event?: string, data: string }): Promise<void>
  onClosed(callback: () => unknown): void
  send(): Promise<void>
}

export function publicRealtimeHttpDependencies(event: H3Event): PublicRealtimeHttpDependencies {
  if (!event.context.services) {
    throw createApiError(503, 'platform.not_ready', '控制面数据库服务尚未就绪')
  }
  return {
    contests: contestHttpDependencies(event).contests,
    realtime: event.context.services.publicRealtime,
  }
}

export async function handlePublicContestEvents(
  event: H3Event,
  contestId: string,
  dependencies = publicRealtimeHttpDependencies(event),
  stream: PublicRealtimeEventStream = createEventStream(event),
) {
  await readPublicContest(contestId, { contests: dependencies.contests })

  const header = getHeader(event, 'last-event-id')
  const lastEventId = header === undefined ? null : uuidSchema.parse(header)
  const queued: PublicRealtimeEvent[] = []
  const sent = new Set<string>()
  const sentOrder: string[] = []
  let recovering = true
  let sendChain = Promise.resolve()

  const send = (realtimeEvent: PublicRealtimeEvent) => {
    if (sent.has(realtimeEvent.id)) return
    sent.add(realtimeEvent.id)
    sentOrder.push(realtimeEvent.id)
    if (sentOrder.length > 1_000) sent.delete(sentOrder.shift()!)
    sendChain = sendChain.then(() => stream.push({
      id: realtimeEvent.id,
      event: realtimeEvent.type,
      data: JSON.stringify(realtimeEvent),
    }))
  }

  const unsubscribe = await dependencies.realtime.subscribe(contestId, (realtimeEvent) => {
    if (recovering) queued.push(realtimeEvent)
    else send(realtimeEvent)
  })
  const recovery = await dependencies.realtime.recover(contestId, lastEventId)
  if (recovery.status === 'reset') {
    sendChain = sendChain.then(() => stream.push({
      event: 'reset',
      data: JSON.stringify({ reason: 'recovery_window_unavailable' }),
    }))
  }
  else {
    for (const realtimeEvent of recovery.events) send(realtimeEvent)
  }
  recovering = false
  for (const realtimeEvent of queued) send(realtimeEvent)
  await sendChain

  stream.onClosed(unsubscribe)
  return stream.send()
}
