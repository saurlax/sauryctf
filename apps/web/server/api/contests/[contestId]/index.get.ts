import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../shared/contracts/common-types'
import { handlePublicContest } from '../../../infrastructure/contests/contest-http'
import { createApiError } from '../../../infrastructure/http/errors'

export default defineEventHandler((event) => {
  if (!event.context.services) {
    throw createApiError(503, 'platform.not_ready', '控制面数据库服务尚未就绪')
  }
  return handlePublicContest(
    event,
    uuidSchema.parse(getRouterParam(event, 'contestId')),
    { contests: event.context.services.contests },
  )
})
