import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../shared/contracts/common-types'
import { handleListManagedAnnouncements } from '../../../../../infrastructure/announcements/announcement-http'

export default defineEventHandler(event => handleListManagedAnnouncements(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
