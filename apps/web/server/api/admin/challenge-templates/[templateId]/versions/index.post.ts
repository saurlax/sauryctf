import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../shared/contracts/common-types'
import { handleCreateChallengeTemplateVersion } from '../../../../../infrastructure/challenges/challenge-template-http'

export default defineEventHandler(event => handleCreateChallengeTemplateVersion(
  event,
  uuidSchema.parse(getRouterParam(event, 'templateId')),
))
