import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handleSubmitOwnWriteup } from '../../../../infrastructure/content/writeup-http'

export default defineEventHandler(event => handleSubmitOwnWriteup(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
