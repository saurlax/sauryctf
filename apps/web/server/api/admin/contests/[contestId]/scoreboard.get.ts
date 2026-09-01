import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handleInternalScoreboard } from '../../../../infrastructure/scoreboards/scoreboard-http'

export default defineEventHandler(event => handleInternalScoreboard(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
