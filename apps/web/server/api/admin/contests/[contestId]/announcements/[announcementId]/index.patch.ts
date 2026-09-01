import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../../shared/contracts/common-types'
import { handleUpdateAnnouncement } from '../../../../../../infrastructure/announcements/announcement-http'

export default defineEventHandler(event => handleUpdateAnnouncement(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
  uuidSchema.parse(getRouterParam(event, 'announcementId')),
))
