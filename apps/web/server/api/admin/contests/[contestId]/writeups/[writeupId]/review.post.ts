import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../../shared/contracts/common-types'
import { handleReviewWriteup } from '../../../../../../infrastructure/content/writeup-http'

export default defineEventHandler(event => handleReviewWriteup(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
  uuidSchema.parse(getRouterParam(event, 'writeupId')),
))
