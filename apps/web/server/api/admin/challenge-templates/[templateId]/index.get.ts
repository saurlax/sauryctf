import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handleReadChallengeTemplate } from '../../../../infrastructure/challenges/challenge-template-http'

export default defineEventHandler(event => handleReadChallengeTemplate(
  event,
  uuidSchema.parse(getRouterParam(event, 'templateId')),
  undefined,
))
