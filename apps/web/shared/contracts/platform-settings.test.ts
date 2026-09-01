import { describe, expect, it } from 'vitest'
import { updatePlatformSettingsRequestSchema } from './platform-settings'

describe('platform settings contract', () => {
  it('accepts only implemented password authentication', () => {
    expect(updatePlatformSettingsRequestSchema.safeParse({
      authentication_mode: 'password_only',
      reason: 'keep password sign-in enabled',
    }).success).toBe(true)
    expect(updatePlatformSettingsRequestSchema.safeParse({
      authentication_mode: 'oidc_only',
      reason: 'unsupported mode',
    }).success).toBe(false)
    expect(updatePlatformSettingsRequestSchema.safeParse({
      authentication_mode: 'password_and_oidc',
      reason: 'unsupported mode',
    }).success).toBe(false)
  })

  it('rejects deployment secrets and unknown settings keys', () => {
    for (const key of [
      'NUXT_SESSION_PASSWORD',
      'database_url',
      'redis_url',
      's3_secret_access_key',
      'worker_credential',
      'oidc_client_secret',
    ]) {
      expect(updatePlatformSettingsRequestSchema.safeParse({
        brand_name: 'SauryCTF',
        reason: 'attempt unknown setting',
        [key]: 'must-not-persist',
      }).success).toBe(false)
    }
  })
})
