import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../../shared/contracts/common-types'
import { handleAssignParticipationDivision } from '../../../../../../infrastructure/participations/participation-http'

export default defineEventHandler(event => handleAssignParticipationDivision(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
  uuidSchema.parse(getRouterParam(event, 'participationId')),
))
