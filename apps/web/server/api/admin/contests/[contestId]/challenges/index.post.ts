import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../shared/contracts/common-types'
import { handleMountContestChallenge } from '../../../../../infrastructure/challenges/contest-challenge-http'

export default defineEventHandler(event => handleMountContestChallenge(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
