import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../../shared/contracts/common-types'
import { handleRenewPlayerInstance } from '../../../../../../infrastructure/instances/instance-http'

export default defineEventHandler(event => handleRenewPlayerInstance(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
  uuidSchema.parse(getRouterParam(event, 'challengeId')),
))
