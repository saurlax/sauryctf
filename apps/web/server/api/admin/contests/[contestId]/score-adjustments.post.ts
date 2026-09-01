import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handleRecordScoreAdjustment } from '../../../../infrastructure/submissions/submission-http'

export default defineEventHandler(event => handleRecordScoreAdjustment(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
