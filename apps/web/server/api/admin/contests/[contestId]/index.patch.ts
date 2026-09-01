import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handleUpdateContestDraft } from '../../../../infrastructure/contests/contest-http'

export default defineEventHandler(event => handleUpdateContestDraft(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
