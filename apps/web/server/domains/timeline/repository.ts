import type { PublicTimelineEvent } from '../../../shared/contracts/timeline'

export interface PublicTimelineEventRecord {
  id: string
  eventType: PublicTimelineEvent['type']
  occurredAt: Date
  visibleAt: Date
  payload: PublicTimelineEvent['payload']
}

export interface PublicTimelinePage {
  items: PublicTimelineEventRecord[]
  nextCursor: string | null
  hasMore: boolean
}

export interface PublicTimelineRepository {
  listPublic(contestId: string, cursor: string | undefined, limit: number): Promise<PublicTimelinePage>
}

export class PublicTimelineContestNotFoundError extends Error {}
export class PublicTimelineCursorInvalidError extends Error {}
