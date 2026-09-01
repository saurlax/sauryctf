import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../shared/contracts/common-types'
import { handleCreateContestPackageExport } from '../../../../../infrastructure/content/contest-package-http'

export default defineEventHandler(event => handleCreateContestPackageExport(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
