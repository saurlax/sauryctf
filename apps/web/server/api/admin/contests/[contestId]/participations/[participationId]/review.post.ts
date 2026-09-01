import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../../shared/contracts/common-types'
import { handleReviewParticipation } from '../../../../../../infrastructure/participations/participation-http'

export default defineEventHandler(event => handleReviewParticipation(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
  uuidSchema.parse(getRouterParam(event, 'participationId')),
))
