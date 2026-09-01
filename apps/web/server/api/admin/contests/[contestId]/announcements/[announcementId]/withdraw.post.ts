import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../../shared/contracts/common-types'
import { handleWithdrawAnnouncement } from '../../../../../../infrastructure/announcements/announcement-http'

export default defineEventHandler(event => handleWithdrawAnnouncement(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
  uuidSchema.parse(getRouterParam(event, 'announcementId')),
))
