import { z } from 'zod'
import { resourceVersionSchema, utcTimestampSchema, uuidSchema } from './common-types'

export const platformThemeSchema = z.enum(['system', 'light', 'dark'])
export const platformLocaleSchema = z.enum(['zh-CN', 'en'])
export const authenticationModeSchema = z.literal('password_only')

export const publicPlatformSettingsSchema = z.strictObject({
  brand_name: z.string().trim().min(1).max(120),
  logo_object_id: uuidSchema.nullable(),
  logo_url: z.string().startsWith('/').nullable(),
  theme: platformThemeSchema,
  default_locale: platformLocaleSchema,
  public_registration_enabled: z.boolean(),
  authentication_mode: authenticationModeSchema,
  version: resourceVersionSchema,
})

export const managedPlatformSettingsSchema = publicPlatformSettingsSchema.extend({
  updated_by: uuidSchema.nullable(),
  updated_at: utcTimestampSchema,
})

export const updatePlatformSettingsRequestSchema = z.strictObject({
  brand_name: z.string().trim().min(1).max(120).optional(),
  logo_object_id: uuidSchema.nullable().optional(),
  theme: platformThemeSchema.optional(),
  default_locale: platformLocaleSchema.optional(),
  public_registration_enabled: z.boolean().optional(),
  authentication_mode: authenticationModeSchema.optional(),
  reason: z.string().trim().min(3).max(1000),
}).superRefine((input, context) => {
  if (Object.keys(input).every(key => key === 'reason')) {
    context.addIssue({ code: 'custom', path: ['request'], message: '至少需要修改一个平台设置字段' })
  }
})

export const publicPlatformSettingsResponseSchema = z.strictObject({
  settings: publicPlatformSettingsSchema,
})

export const managedPlatformSettingsResponseSchema = z.strictObject({
  settings: managedPlatformSettingsSchema,
})

export type PlatformTheme = z.infer<typeof platformThemeSchema>
export type PlatformLocale = z.infer<typeof platformLocaleSchema>
export type AuthenticationMode = z.infer<typeof authenticationModeSchema>
export type PublicPlatformSettings = z.infer<typeof publicPlatformSettingsSchema>
export type ManagedPlatformSettings = z.infer<typeof managedPlatformSettingsSchema>
