import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../shared/contracts/common-types'
import { handlePublicScoreboard } from '../../../infrastructure/scoreboards/scoreboard-http'

export default defineEventHandler(event => handlePublicScoreboard(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
