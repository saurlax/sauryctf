import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../../shared/contracts/common-types'
import { handleReadContestChallenge } from '../../../../../../infrastructure/challenges/contest-challenge-http'

export default defineEventHandler(event => handleReadContestChallenge(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
  uuidSchema.parse(getRouterParam(event, 'challengeId')),
))
