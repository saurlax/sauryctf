import { publicTimelineEventSchema, type PublicTimelineEvent } from '../../../shared/contracts/timeline'
import {
  PublicTimelineContestNotFoundError,
  PublicTimelineCursorInvalidError,
  type PublicTimelineEventRecord,
  type PublicTimelinePage,
  type PublicTimelineRepository,
} from '../../domains/timeline/repository'
import type { DatabaseExecutor } from './executor'

interface TimelineRow {
  event_key: string
  event_type: PublicTimelineEvent['type']
  occurred_at: Date
  visible_at: Date
  payload: unknown
}

interface TimelineCursor {
  visibleAt: Date
  eventKey: string
}

export class PostgresPublicTimelineRepository implements PublicTimelineRepository {
  constructor(private database: DatabaseExecutor) {}

  async listPublic(contestId: string, cursor: string | undefined, limit: number): Promise<PublicTimelinePage> {
    const contest = await this.database.query(
      `SELECT 1 FROM contests
       WHERE id = $1 AND visibility = 'public'
         AND publication_status IN ('published', 'archived')`,
      [contestId],
    )
    if (!contest.rows[0]) throw new PublicTimelineContestNotFoundError()

    const anchor = cursor ? this.decodeCursor(cursor) : null
    const result = await this.database.query<TimelineRow>(
      `WITH contest_scope AS (
         SELECT id, published_at, start_at, end_at, scoreboard_freeze_at
         FROM contests
         WHERE id = $1 AND visibility = 'public'
           AND publication_status IN ('published', 'archived')
       ),
       candidates AS (
         SELECT ce.event_key,
                ce.event_type::text AS event_type,
                ce.occurred_at,
                CASE
                  WHEN ce.event_type = 'first_solve'
                    AND c.scoreboard_freeze_at IS NOT NULL
                    AND ce.occurred_at >= c.scoreboard_freeze_at
                  THEN GREATEST(ce.visible_at, c.end_at, c.published_at)
                  ELSE GREATEST(ce.visible_at, c.published_at)
                END AS visible_at,
                ce.payload,
                1 AS source_priority
         FROM contest_events ce
         JOIN contest_scope c ON c.id = ce.contest_id

         UNION ALL

         SELECT 'announcement:' || a.id::text || ':published',
                'announcement_published',
                a.publish_at,
                GREATEST(a.publish_at, c.published_at),
                jsonb_build_object('announcement_id', a.id, 'title', a.title),
                0
         FROM announcements a
         JOIN contest_scope c ON c.id = a.contest_id
         WHERE a.withdrawn_at IS NULL

         UNION ALL

         SELECT 'contest:phase:upcoming',
                'contest_phase_changed',
                c.published_at,
                c.published_at,
                jsonb_build_object('phase', 'upcoming'),
                0
         FROM contest_scope c
         WHERE c.published_at < c.start_at

         UNION ALL

         SELECT 'contest:phase:running',
                'contest_phase_changed',
                GREATEST(c.published_at, c.start_at),
                GREATEST(c.published_at, c.start_at),
                jsonb_build_object('phase', 'running'),
                0
         FROM contest_scope c
         WHERE c.published_at < c.end_at

         UNION ALL

         SELECT 'contest:phase:ended',
                'contest_phase_changed',
                GREATEST(c.published_at, c.end_at),
                GREATEST(c.published_at, c.end_at),
                jsonb_build_object('phase', 'ended'),
                0
         FROM contest_scope c

         UNION ALL

         SELECT 'scoreboard:freeze',
                'scoreboard_frozen',
                GREATEST(c.published_at, c.scoreboard_freeze_at),
                GREATEST(c.published_at, c.scoreboard_freeze_at),
                '{}'::jsonb,
                0
         FROM contest_scope c
         WHERE c.scoreboard_freeze_at IS NOT NULL
       ),
       timeline AS (
         SELECT DISTINCT ON (event_key)
                event_key, event_type, occurred_at, visible_at, payload
         FROM candidates
         ORDER BY event_key, source_priority, occurred_at
       ),
       normalized_timeline AS (
         SELECT event_key,
                event_type,
                date_trunc('milliseconds', occurred_at) AS occurred_at,
                date_trunc('milliseconds', visible_at) AS visible_at,
                payload
         FROM timeline
       )
       SELECT event_key, event_type, occurred_at, visible_at, payload
       FROM normalized_timeline
       WHERE visible_at <= CURRENT_TIMESTAMP
         AND ($2::timestamptz IS NULL OR (visible_at, event_key) < ($2, $3))
       ORDER BY visible_at DESC, event_key DESC
       LIMIT $4`,
      [contestId, anchor?.visibleAt ?? null, anchor?.eventKey ?? null, limit + 1],
    )
    const hasMore = result.rows.length > limit
    const included = hasMore ? result.rows.slice(0, limit) : result.rows
    const records = included.map(row => this.record(row))
    return {
      items: records,
      nextCursor: hasMore ? this.encodeCursor(records.at(-1)!) : null,
      hasMore,
    }
  }

  private record(row: TimelineRow): PublicTimelineEventRecord {
    const event = publicTimelineEventSchema.parse({
      id: row.event_key,
      type: row.event_type,
      occurred_at: row.occurred_at.toISOString(),
      visible_at: row.visible_at.toISOString(),
      payload: row.payload,
    })
    return {
      id: event.id,
      eventType: event.type,
      occurredAt: row.occurred_at,
      visibleAt: row.visible_at,
      payload: event.payload,
    }
  }

  private encodeCursor(record: PublicTimelineEventRecord) {
    return Buffer.from(JSON.stringify([
      record.visibleAt.toISOString(),
      record.id,
    ]), 'utf8').toString('base64url')
  }

  private decodeCursor(cursor: string): TimelineCursor {
    try {
      const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
      if (!Array.isArray(decoded) || decoded.length !== 2
        || typeof decoded[0] !== 'string' || typeof decoded[1] !== 'string'
        || decoded[1].length < 1 || decoded[1].length > 200) {
        throw new TypeError('Invalid timeline cursor shape')
      }
      const visibleAt = new Date(decoded[0])
      if (Number.isNaN(visibleAt.getTime()) || visibleAt.toISOString() !== decoded[0]) {
        throw new TypeError('Invalid timeline cursor timestamp')
      }
      return { visibleAt, eventKey: decoded[1] }
    }
    catch {
      throw new PublicTimelineCursorInvalidError()
    }
  }
}
