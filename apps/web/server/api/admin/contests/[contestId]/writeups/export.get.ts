import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../shared/contracts/common-types'
import { handleExportSubmittedWriteups } from '../../../../../infrastructure/content/writeup-http'

export default defineEventHandler(event => handleExportSubmittedWriteups(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
