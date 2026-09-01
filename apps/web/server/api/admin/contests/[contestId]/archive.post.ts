import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handleArchiveContest } from '../../../../infrastructure/contests/contest-http'

export default defineEventHandler(event => handleArchiveContest(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
