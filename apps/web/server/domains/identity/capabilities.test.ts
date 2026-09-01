import { describe, expect, it } from 'vitest'
import type { SessionSubject } from './repository'
import {
  globalRoleCapabilities,
  hasIdentityCapability,
  identityCapability,
  requireIdentityCapability,
} from './capabilities'

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
    identityCapability.contestManage,
    identityCapability.contestJudge,
    identityCapability.userManage,
    identityCapability.roleManage,
    identityCapability.platformSettingsManage,
    identityCapability.globalOperationsManage,
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

describe('global role capability matrix', () => {
  const verified = { ...subject, emailVerified: true }

  it('keeps ordinary users out of every management capability', () => {
    for (const capability of [
      identityCapability.contestManage,
      identityCapability.contestJudge,
      identityCapability.userManage,
      identityCapability.roleManage,
      identityCapability.platformSettingsManage,
      identityCapability.globalOperationsManage,
    ]) {
      expect(hasIdentityCapability(verified, capability)).toBe(false)
      expect(() => requireIdentityCapability(verified, capability)).toThrowError(
        expect.objectContaining({ code: 'identity.capability_forbidden' }),
      )
    }
  })

  it('allows organizers to manage and judge every contest without a contest binding', () => {
    const organizer = { ...verified, role: 'organizer' as const }
    expect(() => requireIdentityCapability(organizer, identityCapability.contestManage)).not.toThrow()
    expect(() => requireIdentityCapability(organizer, identityCapability.contestJudge)).not.toThrow()
    expect(hasIdentityCapability(organizer, identityCapability.userManage)).toBe(false)
    expect(hasIdentityCapability(organizer, identityCapability.roleManage)).toBe(false)
  })

  it('reserves user, role, setting, and global operation management for admins', () => {
    const admin = { ...verified, role: 'admin' as const }
    for (const capability of [
      identityCapability.userManage,
      identityCapability.roleManage,
      identityCapability.platformSettingsManage,
      identityCapability.globalOperationsManage,
    ]) {
      expect(() => requireIdentityCapability(admin, capability)).not.toThrow()
    }
  })

  it('defines exactly the three supported global role rows', () => {
    expect(Object.keys(globalRoleCapabilities)).toEqual(['user', 'organizer', 'admin'])
  })
})
