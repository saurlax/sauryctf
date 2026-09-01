import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../shared/contracts/common-types'
import { handleRegisterParticipation } from '../../../infrastructure/participations/participation-http'

export default defineEventHandler(event => handleRegisterParticipation(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
