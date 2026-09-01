import { z } from 'zod'

const passwordSchema = z.string().min(1).max(1024)
const emailSchema = z.email().max(320)
const identityTokenSchema = z.string().min(32).max(512).regex(/^[A-Za-z0-9_-]+$/u)

export const changePasswordRequestSchema = z.strictObject({
  current_password: passwordSchema,
  new_password: passwordSchema,
})

export const passwordResetRequestSchema = z.strictObject({
  email: emailSchema,
  turnstile_token: z.string().min(1).max(2048).optional(),
})

export const passwordResetConfirmRequestSchema = z.strictObject({
  token: identityTokenSchema,
  new_password: passwordSchema,
})

export const emailVerificationConfirmRequestSchema = z.strictObject({
  token: identityTokenSchema,
})

export const passwordResetAcceptedSchema = z.strictObject({
  accepted: z.literal(true),
})

export const passwordChangedSchema = z.strictObject({
  changed: z.literal(true),
})

export const emailVerifiedSchema = z.strictObject({
  verified: z.literal(true),
})

export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>
export type PasswordResetConfirmRequest = z.infer<typeof passwordResetConfirmRequestSchema>
export type EmailVerificationConfirmRequest = z.infer<typeof emailVerificationConfirmRequestSchema>
export type PasswordResetAccepted = z.infer<typeof passwordResetAcceptedSchema>
export type PasswordChanged = z.infer<typeof passwordChangedSchema>
export type EmailVerified = z.infer<typeof emailVerifiedSchema>

export function publicPasswordResetResponse(): PasswordResetAccepted {
  return { accepted: true }
}
