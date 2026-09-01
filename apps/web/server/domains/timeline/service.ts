import {
  PublicTimelineContestNotFoundError,
  PublicTimelineCursorInvalidError,
  type PublicTimelinePage,
  type PublicTimelineRepository,
} from './repository'

export type PublicTimelineServiceErrorCode = 'timeline.contest_not_found' | 'timeline.cursor_invalid'

export class PublicTimelineServiceError extends Error {
  constructor(readonly code: PublicTimelineServiceErrorCode) {
    super({
      'timeline.contest_not_found': '比赛不存在或当前不可访问',
      'timeline.cursor_invalid': '时间线游标无效或已经过期',
    }[code])
    this.name = 'PublicTimelineServiceError'
  }
}

export class PublicTimelineService {
  constructor(private repository: PublicTimelineRepository) {}

  async listPublic(
    contestId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<PublicTimelinePage> {
    try {
      return await this.repository.listPublic(contestId, cursor, limit)
    }
    catch (error) {
      if (error instanceof PublicTimelineContestNotFoundError) {
        throw new PublicTimelineServiceError('timeline.contest_not_found')
      }
      if (error instanceof PublicTimelineCursorInvalidError) {
        throw new PublicTimelineServiceError('timeline.cursor_invalid')
      }
      throw error
    }
  }
}
