import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handleListPublicTimeline } from '../../../../infrastructure/timeline/public-timeline-http'

export default defineEventHandler(event => handleListPublicTimeline(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
