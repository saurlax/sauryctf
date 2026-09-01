import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handleSaveOwnWriteup } from '../../../../infrastructure/content/writeup-http'

export default defineEventHandler(event => handleSaveOwnWriteup(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
