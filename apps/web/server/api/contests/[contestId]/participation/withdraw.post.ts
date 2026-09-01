import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handleWithdrawParticipation } from '../../../../infrastructure/participations/participation-http'

export default defineEventHandler(event => handleWithdrawParticipation(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
