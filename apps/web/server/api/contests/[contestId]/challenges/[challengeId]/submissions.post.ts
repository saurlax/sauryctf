import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../shared/contracts/common-types'
import { handleSubmitFlag } from '../../../../../infrastructure/submissions/submission-http'

export default defineEventHandler(event => handleSubmitFlag(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
  uuidSchema.parse(getRouterParam(event, 'challengeId')),
))
