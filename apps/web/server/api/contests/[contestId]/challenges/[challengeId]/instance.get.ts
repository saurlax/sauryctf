import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../shared/contracts/common-types'
import { handleReadPlayerInstance } from '../../../../../infrastructure/instances/instance-http'

export default defineEventHandler(event => handleReadPlayerInstance(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
  uuidSchema.parse(getRouterParam(event, 'challengeId')),
))
