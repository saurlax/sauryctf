import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../../shared/contracts/common-types'
import { handleCorrectWriteup } from '../../../../../../infrastructure/content/writeup-http'

export default defineEventHandler(event => handleCorrectWriteup(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
  uuidSchema.parse(getRouterParam(event, 'writeupId')),
))
