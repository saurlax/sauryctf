import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../shared/contracts/common-types'
import { handlePublicContestEvents } from '../../../infrastructure/events/public-realtime-http'

export default defineEventHandler(event => handlePublicContestEvents(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
