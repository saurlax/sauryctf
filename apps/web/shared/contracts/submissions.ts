import { z } from 'zod'

export const submitFlagRequestSchema = z.strictObject({
  flag: z.string().min(1).max(1024),
})

export const submitFlagResponseSchema = z.strictObject({
  result: z.enum(['correct', 'incorrect']),
})

export type SubmitFlagRequest = z.infer<typeof submitFlagRequestSchema>
export type SubmitFlagResponse = z.infer<typeof submitFlagResponseSchema>
