import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../shared/contracts/common-types'
import { handleStartPlayerInstance } from '../../../../../infrastructure/instances/instance-http'

export default defineEventHandler(event => handleStartPlayerInstance(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
  uuidSchema.parse(getRouterParam(event, 'challengeId')),
))
