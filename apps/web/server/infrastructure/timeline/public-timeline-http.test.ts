import { createApp, eventHandler, setResponseStatus, toWebHandler, type H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import { PublicTimelineServiceError } from '../../domains/timeline/service'
import { normalizeApiError } from '../http/errors'
import {
  handleListPublicTimeline,
  type PublicTimelineHttpDependencies,
} from './public-timeline-http'

const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c'
const contestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2e'
const announcementId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2f'
const record = {
  id: `announcement:${announcementId}:published`,
  eventType: 'announcement_published' as const,
  occurredAt: new Date('2026-09-01T07:08:09.123Z'),
  visibleAt: new Date('2026-09-01T07:08:09.123Z'),
  payload: { announcement_id: announcementId, title: 'Competition notice' },
}

function dependencies(
  overrides: Partial<PublicTimelineHttpDependencies['timeline']> = {},
): PublicTimelineHttpDependencies {
  return {
    timeline: {
      listPublic: vi.fn(async () => ({
        items: [record],
        nextCursor: 'WyIyMDI2LTA5LTAxVDA3OjA4OjA5LjEyM1oiLCJldmVudCJd',
        hasMore: true,
      })),
      ...overrides,
    },
  }
}

async function invoke(
  handler: (event: H3Event) => Promise<unknown>,
  query = '',
) {
  const app = createApp()
  app.use(eventHandler(async (event) => {
    event.context.requestId = requestId
    try {
      return await handler(event)
    }
    catch (error) {
      const response = normalizeApiError(error, requestId)
      setResponseStatus(event, response.statusCode)
      return response.body
    }
  }))
  return toWebHandler(app)(new Request(`https://ctf.example.test/api/contests/test/timeline${query}`))
}

describe('public timeline HTTP adapter', () => {
  it('returns the selected event projection without a browser session', async () => {
    const deps = dependencies()
    const cursor = 'WyIyMDI2LTA5LTAxVDA3OjA4OjA5LjEyM1oiLCJldmVudCJd'
    const response = await invoke(
      event => handleListPublicTimeline(event, contestId, deps),
      `?cursor=${cursor}&limit=10`,
    )
    expect(response.status).toBe(200)
    expect(deps.timeline.listPublic).toHaveBeenCalledWith(contestId, cursor, 10)
    await expect(response.json()).resolves.toEqual({
      items: [{
        id: record.id,
        type: 'announcement_published',
        occurred_at: '2026-09-01T07:08:09.123Z',
        visible_at: '2026-09-01T07:08:09.123Z',
        payload: { announcement_id: announcementId, title: 'Competition notice' },
      }],
      page: { next_cursor: cursor, has_more: true },
    })
  })

  it('rejects malformed query cursors before reading the timeline', async () => {
    const deps = dependencies()
    const response = await invoke(
      event => handleListPublicTimeline(event, contestId, deps),
      '?cursor=invalid%3Acursor&limit=10',
    )
    expect(response.status).toBe(400)
    expect(deps.timeline.listPublic).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'validation.failed', request_id: requestId },
    })
  })

  it.each([
    ['timeline.cursor_invalid', 400],
    ['timeline.contest_not_found', 404],
  ] as const)('maps %s to a stable public error', async (code, status) => {
    const deps = dependencies({
      listPublic: vi.fn(async () => { throw new PublicTimelineServiceError(code) }),
    })
    const response = await invoke(event => handleListPublicTimeline(event, contestId, deps))
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toMatchObject({
      error: { code, request_id: requestId },
    })
  })
})
