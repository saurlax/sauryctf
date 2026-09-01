import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handleReadPlayerContestChallenge } from '../../../../infrastructure/challenges/contest-challenge-http'

export default defineEventHandler(event => handleReadPlayerContestChallenge(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
  uuidSchema.parse(getRouterParam(event, 'challengeId')),
))
