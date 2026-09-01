import { describe, expect, it } from 'vitest'
import type { SessionSubject } from './repository'
import { identityCapability, requireIdentityCapability } from './capabilities'

const subject: SessionSubject = {
  userId: '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c',
  username: 'Player',
  email: 'player@example.test',
  emailVerified: false,
  status: 'active',
  role: 'user',
  sessionVersion: 1,
  mustChangePassword: false,
}

describe('unverified identity capability gate', () => {
  it.each([
    identityCapability.publicBrowse,
    identityCapability.accountRead,
    identityCapability.accountWrite,
    identityCapability.verificationResend,
    identityCapability.logout,
  ])('allows %s', (capability) => {
    expect(() => requireIdentityCapability(subject, capability)).not.toThrow()
  })

  it.each([
    identityCapability.teamWrite,
    identityCapability.contestRegister,
    identityCapability.flagSubmit,
    identityCapability.writeupWrite,
    identityCapability.instanceOperate,
    identityCapability.organize,
    identityCapability.administer,
  ])('rejects %s with a stable email verification error', (capability) => {
    expect(() => requireIdentityCapability(subject, capability)).toThrowError(
      expect.objectContaining({ code: 'identity.email_verification_required' }),
    )
  })

  it('allows participation capabilities after verification', () => {
    expect(() => requireIdentityCapability({ ...subject, emailVerified: true }, identityCapability.teamWrite))
      .not.toThrow()
  })
})
