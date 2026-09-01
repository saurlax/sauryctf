import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handleContestPublicationCheck } from '../../../../infrastructure/contests/contest-http'

export default defineEventHandler(event => handleContestPublicationCheck(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
