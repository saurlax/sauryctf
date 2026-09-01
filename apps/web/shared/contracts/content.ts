import { z } from 'zod'

export const contentObjectStatusSchema = z.enum(['temporary', 'committed'])

export const contentObjectResponseSchema = z.strictObject({
  id: z.uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  size_bytes: z.number().int().positive().max(64 * 1024 * 1024),
  media_type: z.string().min(3).max(255),
  original_filename: z.string().min(1).max(255),
  status: contentObjectStatusSchema,
  committed_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
})

export const commitContentUploadRequestSchema = z.strictObject({
  sha256: z.string().regex(/^[a-f0-9]{64}$/u, '必须提交 SHA-256 十六进制摘要'),
})

export type ContentObjectResponse = z.infer<typeof contentObjectResponseSchema>
