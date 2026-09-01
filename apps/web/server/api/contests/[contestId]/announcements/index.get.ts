import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import {
  announcementHttpDependencies,
  handleListPublicAnnouncements,
} from '../../../../infrastructure/announcements/announcement-http'

export default defineEventHandler((event) => {
  const dependencies = announcementHttpDependencies(event)
  return handleListPublicAnnouncements(
    event,
    uuidSchema.parse(getRouterParam(event, 'contestId')),
    { announcements: dependencies.announcements },
  )
})
