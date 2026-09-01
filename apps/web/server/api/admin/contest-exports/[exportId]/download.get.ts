import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handleDownloadContestPackageExport } from '../../../../infrastructure/content/contest-package-http'

export default defineEventHandler(event => handleDownloadContestPackageExport(
  event,
  uuidSchema.parse(getRouterParam(event, 'exportId')),
))
