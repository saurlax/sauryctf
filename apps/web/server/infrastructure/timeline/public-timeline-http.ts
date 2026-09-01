import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import {
  publicTimelineEventSchema,
  publicTimelineListRequestSchema,
  publicTimelineListResponseSchema,
} from '../../../shared/contracts/timeline'
import type { PublicTimelineEventRecord } from '../../domains/timeline/repository'
import {
  PublicTimelineServiceError,
  type PublicTimelineService,
} from '../../domains/timeline/service'
import { createApiError } from '../http/errors'

type PublicTimelineCommands = Pick<PublicTimelineService, 'listPublic'>

export interface PublicTimelineHttpDependencies {
  timeline: PublicTimelineCommands
}

export function publicTimelineHttpDependencies(event: H3Event): PublicTimelineHttpDependencies {
  if (!event.context.services) {
    throw createApiError(503, 'platform.not_ready', '控制面数据库服务尚未就绪')
  }
  return { timeline: event.context.services.timeline }
}

function projection(record: PublicTimelineEventRecord) {
  return publicTimelineEventSchema.parse({
    id: record.id,
    type: record.eventType,
    occurred_at: record.occurredAt.toISOString(),
    visible_at: record.visibleAt.toISOString(),
    payload: record.payload,
  })
}

async function runTimelineOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (!(error instanceof PublicTimelineServiceError)) throw error
    const statusCode = {
      'timeline.contest_not_found': 404,
      'timeline.cursor_invalid': 400,
    }[error.code]
    throw createApiError(statusCode, error.code, error.message, error.code === 'timeline.cursor_invalid'
      ? { cursor: ['请从上一页响应中使用未修改的 next_cursor'] }
      : {})
  }
}

export async function handleListPublicTimeline(
  event: H3Event,
  contestId: string,
  dependencies = publicTimelineHttpDependencies(event),
) {
  const input = publicTimelineListRequestSchema.parse(getQuery(event))
  const result = await runTimelineOperation(() => dependencies.timeline.listPublic(
    contestId,
    input.cursor,
    input.limit,
  ))
  return publicTimelineListResponseSchema.parse({
    items: result.items.map(projection),
    page: { next_cursor: result.nextCursor, has_more: result.hasMore },
  })
}
