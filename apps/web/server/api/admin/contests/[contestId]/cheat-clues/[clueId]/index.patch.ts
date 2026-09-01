import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../../shared/contracts/common-types'
import { handleReviewCheatClue } from '../../../../../../infrastructure/submissions/submission-http'

export default defineEventHandler(event => handleReviewCheatClue(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
  uuidSchema.parse(getRouterParam(event, 'clueId')),
))
