import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handleOwnWriteup } from '../../../../infrastructure/content/writeup-http'

export default defineEventHandler(event => handleOwnWriteup(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
