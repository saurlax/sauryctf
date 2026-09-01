import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../shared/contracts/common-types'
import { handleRemoveMember } from '../../../infrastructure/teams/team-http'
export default defineEventHandler(event => handleRemoveMember(event, uuidSchema.parse(getRouterParam(event,'userId'))))
