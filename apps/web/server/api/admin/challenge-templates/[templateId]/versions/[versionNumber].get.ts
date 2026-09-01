import { getRouterParam } from 'h3'
import { z } from 'zod'
import { uuidSchema } from '../../../../../../shared/contracts/common-types'
import { handleReadChallengeTemplate } from '../../../../../infrastructure/challenges/challenge-template-http'

export default defineEventHandler(event => handleReadChallengeTemplate(
  event,
  uuidSchema.parse(getRouterParam(event, 'templateId')),
  z.coerce.number().int().positive().parse(getRouterParam(event, 'versionNumber')),
))
