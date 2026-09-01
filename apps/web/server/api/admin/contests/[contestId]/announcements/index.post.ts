import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../../shared/contracts/common-types'
import { handleCreateAnnouncement } from '../../../../../infrastructure/announcements/announcement-http'

export default defineEventHandler(event => handleCreateAnnouncement(
  event,
  uuidSchema.parse(getRouterParam(event, 'contestId')),
))
