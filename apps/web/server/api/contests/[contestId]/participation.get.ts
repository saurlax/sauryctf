import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../shared/contracts/common-types'
import { handleCurrentParticipation } from '../../../infrastructure/participations/participation-http'

export default defineEventHandler(event => handleCurrentParticipation(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
