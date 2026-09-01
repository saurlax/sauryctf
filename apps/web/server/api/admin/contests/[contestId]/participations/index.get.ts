import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../shared/contracts/common-types'
import { handleListParticipations } from '../../../../../infrastructure/participations/participation-http'

export default defineEventHandler(event => handleListParticipations(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
