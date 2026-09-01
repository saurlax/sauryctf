import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handlePublishContest } from '../../../../infrastructure/contests/contest-http'

export default defineEventHandler(event => handlePublishContest(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
