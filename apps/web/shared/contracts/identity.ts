import { z } from 'zod'
import { resourceVersionSchema, utcTimestampSchema, uuidSchema } from './common-types'

const passwordSchema = z.string().min(1).max(1024)
const emailSchema = z.email().max(320)
const identityTokenSchema = z.string().min(32).max(512).regex(/^[A-Za-z0-9_-]+$/u)

export const registerIdentityRequestSchema = z.strictObject({
  username: z.string().trim().min(3).max(64),
  email: emailSchema,
  password: passwordSchema,
  turnstile_token: z.string().min(1).max(2048).optional(),
})

export const loginIdentityRequestSchema = z.strictObject({
  identifier: z.string().trim().min(1).max(320),
  password: passwordSchema,
  turnstile_token: z.string().min(1).max(2048).optional(),
})

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

export const changeEmailRequestSchema = z.strictObject({
  email: emailSchema,
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

export const emailChangedSchema = z.strictObject({
  changed: z.literal(true),
})

export const globalRoleSchema = z.enum(['user', 'organizer', 'admin'])
export const managedUserStatusSchema = z.enum(['active', 'banned'])

export const identityUserSchema = z.strictObject({
  id: uuidSchema,
  username: z.string().min(1).max(64),
  email: emailSchema,
  email_verified: z.boolean(),
  status: managedUserStatusSchema,
  role: globalRoleSchema,
  session_version: resourceVersionSchema,
  must_change_password: z.boolean(),
})

export const managedIdentitySchema = identityUserSchema.extend({
  created_at: utcTimestampSchema,
})

export const identitySessionResponseSchema = z.strictObject({
  user: identityUserSchema,
})

export const identityLogoutResponseSchema = z.strictObject({
  logged_out: z.literal(true),
})

export const adminUserListRequestSchema = z.strictObject({
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const adminUserListResponseSchema = z.strictObject({
  items: z.array(managedIdentitySchema),
  page: z.strictObject({
    next_cursor: uuidSchema.nullable(),
    has_more: z.boolean(),
  }),
})

export const changeUserStatusRequestSchema = z.strictObject({
  status: managedUserStatusSchema,
  reason: z.string().trim().min(3).max(1000),
})

export const userStatusChangedSchema = z.strictObject({
  user_id: uuidSchema,
  previous_status: managedUserStatusSchema,
  status: managedUserStatusSchema,
  session_version: resourceVersionSchema,
  changed: z.boolean(),
})

export const changeGlobalRoleRequestSchema = z.strictObject({
  role: globalRoleSchema,
  reason: z.string().trim().min(3).max(1000),
})

export const globalRoleChangedSchema = z.strictObject({
  user_id: uuidSchema,
  previous_role: globalRoleSchema,
  role: globalRoleSchema,
  session_version: resourceVersionSchema,
  changed: z.boolean(),
})

export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>
export type RegisterIdentityRequest = z.infer<typeof registerIdentityRequestSchema>
export type LoginIdentityRequest = z.infer<typeof loginIdentityRequestSchema>
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>
export type PasswordResetConfirmRequest = z.infer<typeof passwordResetConfirmRequestSchema>
export type EmailVerificationConfirmRequest = z.infer<typeof emailVerificationConfirmRequestSchema>
export type ChangeEmailRequest = z.infer<typeof changeEmailRequestSchema>
export type PasswordResetAccepted = z.infer<typeof passwordResetAcceptedSchema>
export type PasswordChanged = z.infer<typeof passwordChangedSchema>
export type EmailVerified = z.infer<typeof emailVerifiedSchema>
export type EmailChanged = z.infer<typeof emailChangedSchema>
export type GlobalRole = z.infer<typeof globalRoleSchema>
export type ManagedUserStatus = z.infer<typeof managedUserStatusSchema>
export type IdentityUser = z.infer<typeof identityUserSchema>
export type ManagedIdentity = z.infer<typeof managedIdentitySchema>
export type IdentitySessionResponse = z.infer<typeof identitySessionResponseSchema>
export type AdminUserListRequest = z.infer<typeof adminUserListRequestSchema>
export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>
export type ChangeGlobalRoleRequest = z.infer<typeof changeGlobalRoleRequestSchema>
export type GlobalRoleChanged = z.infer<typeof globalRoleChangedSchema>
export type ChangeUserStatusRequest = z.infer<typeof changeUserStatusRequestSchema>
export type UserStatusChanged = z.infer<typeof userStatusChangedSchema>

export function publicPasswordResetResponse(): PasswordResetAccepted {
  return { accepted: true }
}
