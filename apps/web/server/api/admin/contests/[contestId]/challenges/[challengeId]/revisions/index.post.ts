import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../../../shared/contracts/common-types'
import { handleReviseContestChallenge } from '../../../../../../../infrastructure/challenges/contest-challenge-http'

export default defineEventHandler(event => handleReviseContestChallenge(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
  uuidSchema.parse(getRouterParam(event, 'challengeId')),
))
