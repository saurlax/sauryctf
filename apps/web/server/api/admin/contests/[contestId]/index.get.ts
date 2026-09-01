import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handleManagedContest } from '../../../../infrastructure/contests/contest-http'

export default defineEventHandler(event => handleManagedContest(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
