import { describe, expect, it, vi } from 'vitest'
import {
  DisabledHumanVerificationProvider,
  requireHumanVerification,
  type HumanVerificationProvider,
} from './human-verification'

describe('human verification policy', () => {
  it('allows local operation when no external provider is configured', async () => {
    await expect(requireHumanVerification(new DisabledHumanVerificationProvider(), {
      action: 'password_reset',
    })).resolves.toBeUndefined()
  })

  it('requires a token and rejects a failed enabled provider', async () => {
    const provider: HumanVerificationProvider = {
      required: true,
      verify: vi.fn(async () => false),
    }
    await expect(requireHumanVerification(provider, { action: 'password_reset' }))
      .rejects.toMatchObject({ code: 'security.human_verification_required' })
    await expect(requireHumanVerification(provider, {
      action: 'password_reset',
      token: 'invalid',
    })).rejects.toMatchObject({ code: 'security.human_verification_failed' })
  })
})
