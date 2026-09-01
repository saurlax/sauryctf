import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../shared/contracts/common-types'
import { handleListManagedWriteups } from '../../../../../infrastructure/content/writeup-http'

export default defineEventHandler(event => handleListManagedWriteups(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
