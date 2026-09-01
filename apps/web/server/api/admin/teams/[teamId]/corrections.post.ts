import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handleCorrectTeamMembership } from '../../../../infrastructure/teams/team-http'

export default defineEventHandler(event => handleCorrectTeamMembership(
  event,
  uuidSchema.parse(getRouterParam(event, 'teamId')),
))
