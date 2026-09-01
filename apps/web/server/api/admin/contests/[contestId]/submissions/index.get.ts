import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../shared/contracts/common-types'
import { handleListManagedSubmissions } from '../../../../../infrastructure/submissions/submission-http'

export default defineEventHandler(event => handleListManagedSubmissions(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
