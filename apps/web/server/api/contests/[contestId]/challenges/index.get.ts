import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handleListPlayerContestChallenges } from '../../../../infrastructure/challenges/contest-challenge-http'

export default defineEventHandler(event => handleListPlayerContestChallenges(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
