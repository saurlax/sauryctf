import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../shared/contracts/common-types'
import { handleListCheatClues } from '../../../../../infrastructure/submissions/submission-http'

export default defineEventHandler(event => handleListCheatClues(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
