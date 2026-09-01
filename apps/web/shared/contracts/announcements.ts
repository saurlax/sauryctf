import { z } from 'zod'
import { resourceVersionSchema, utcTimestampSchema, uuidSchema } from './common-types'
import { cursorPageSchema } from './http'

export const announcementStatusSchema = z.enum(['scheduled', 'published', 'withdrawn'])

export const announcementSchema = z.strictObject({
  id: uuidSchema,
  contest_id: uuidSchema,
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(100_000),
  status: announcementStatusSchema,
  publish_at: utcTimestampSchema,
  withdrawn_at: utcTimestampSchema.nullable(),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
  version: resourceVersionSchema,
})

export const createAnnouncementRequestSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(100_000),
  publish_at: utcTimestampSchema,
})

export const updateAnnouncementRequestSchema = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(100_000).optional(),
  publish_at: utcTimestampSchema.optional(),
  reason: z.string().trim().min(3).max(1000),
}).superRefine((input, context) => {
  if (input.title === undefined && input.body === undefined && input.publish_at === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['request'],
      message: '至少需要修改一个公告字段',
    })
  }
})

export const withdrawAnnouncementRequestSchema = z.strictObject({
  reason: z.string().trim().min(3).max(1000),
})

export const announcementListRequestSchema = z.strictObject({
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const announcementResponseSchema = z.strictObject({ announcement: announcementSchema })
export const announcementListResponseSchema = cursorPageSchema(announcementSchema)

export type Announcement = z.infer<typeof announcementSchema>
export type AnnouncementStatus = z.infer<typeof announcementStatusSchema>
export type CreateAnnouncementRequest = z.infer<typeof createAnnouncementRequestSchema>
export type UpdateAnnouncementRequest = z.infer<typeof updateAnnouncementRequestSchema>
