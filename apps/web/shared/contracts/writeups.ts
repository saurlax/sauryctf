import { z } from 'zod'
import { resourceVersionSchema, utcTimestampSchema, uuidSchema } from './common-types'
import { cursorPageSchema } from './http'

export const writeupStatusSchema = z.enum([
  'draft',
  'submitted',
  'approved',
  'changes_requested',
])

export const writeupAttachmentSchema = z.strictObject({
  reference_id: uuidSchema,
  content_object_id: uuidSchema,
  filename: z.string().min(1).max(255),
  media_type: z.string().min(3).max(255),
  size_bytes: z.number().int().positive().max(64 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
})

export const writeupVersionSchema = z.strictObject({
  id: uuidSchema,
  version_number: z.number().int().positive(),
  body: z.string().max(1_000_000),
  created_by: uuidSchema,
  created_at: utcTimestampSchema,
  attachments: z.array(writeupAttachmentSchema),
})

export const writeupSchema = z.strictObject({
  id: uuidSchema,
  contest_id: uuidSchema,
  participation_id: uuidSchema,
  team_id: uuidSchema,
  team_name: z.string().min(1).max(120),
  status: writeupStatusSchema,
  current_version: z.number().int().positive(),
  submitted_version: z.number().int().positive().nullable(),
  submitted_at: utcTimestampSchema.nullable(),
  reviewed_by: uuidSchema.nullable(),
  review_note: z.string().max(10_000).nullable(),
  reviewed_at: utcTimestampSchema.nullable(),
  version: resourceVersionSchema,
  updated_at: utcTimestampSchema,
  current: writeupVersionSchema,
  submitted: writeupVersionSchema.nullable(),
})

export const ownWriteupResponseSchema = z.strictObject({
  contest_id: uuidSchema,
  writeup_required: z.boolean(),
  writeup_deadline_at: utcTimestampSchema.nullable(),
  writeup: writeupSchema.nullable(),
})

const attachmentIdsSchema = z.array(uuidSchema).max(50).default([])
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        message: '附件不能重复',
      })
    }
  })

export const saveWriteupRequestSchema = z.strictObject({
  body: z.string().trim().min(1).max(1_000_000),
  attachment_ids: attachmentIdsSchema,
})

export const submitWriteupRequestSchema = z.strictObject({})

export const reviewWriteupRequestSchema = z.strictObject({
  decision: z.enum(['approved', 'changes_requested']),
  note: z.string().trim().max(10_000).nullable().default(null),
}).superRefine((input, context) => {
  if (input.decision === 'changes_requested' && !input.note) {
    context.addIssue({
      code: 'custom',
      path: ['note'],
      message: '要求修改时必须填写审核备注',
    })
  }
})

export const correctWriteupRequestSchema = z.strictObject({
  body: z.string().trim().min(1).max(1_000_000),
  attachment_ids: attachmentIdsSchema,
  reason: z.string().trim().min(3).max(1000),
})

export const managedWriteupListRequestSchema = z.strictObject({
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: writeupStatusSchema.optional(),
})

export const writeupResponseSchema = z.strictObject({ writeup: writeupSchema })
export const managedWriteupListResponseSchema = cursorPageSchema(writeupSchema)

export type Writeup = z.infer<typeof writeupSchema>
export type WriteupStatus = z.infer<typeof writeupStatusSchema>
