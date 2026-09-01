import type { SessionSubject } from './repository'

export const identityCapability = {
  publicBrowse: 'public.browse',
  accountRead: 'account.read',
  accountWrite: 'account.write',
  verificationResend: 'verification.resend',
  logout: 'auth.logout',
  teamWrite: 'team.write',
  contestRegister: 'contest.register',
  flagSubmit: 'flag.submit',
  writeupWrite: 'writeup.write',
  instanceOperate: 'instance.operate',
  organize: 'contest.organize',
  administer: 'platform.administer',
} as const

export type IdentityCapability = typeof identityCapability[keyof typeof identityCapability]

const unverifiedCapabilities = new Set<IdentityCapability>([
  identityCapability.publicBrowse,
  identityCapability.accountRead,
  identityCapability.accountWrite,
  identityCapability.verificationResend,
  identityCapability.logout,
])

export class IdentityCapabilityError extends Error {
  constructor(readonly code: 'identity.email_verification_required' | 'identity.account_setup_required') {
    super(code === 'identity.email_verification_required' ? '请先验证邮箱' : '请先完成账号安全设置')
    this.name = 'IdentityCapabilityError'
  }
}

export function requireIdentityCapability(subject: SessionSubject, capability: IdentityCapability): void {
  if (subject.mustChangePassword && !unverifiedCapabilities.has(capability)) {
    throw new IdentityCapabilityError('identity.account_setup_required')
  }
  if (!subject.emailVerified && !unverifiedCapabilities.has(capability)) {
    throw new IdentityCapabilityError('identity.email_verification_required')
  }
}
