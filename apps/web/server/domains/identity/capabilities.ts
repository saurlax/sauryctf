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
  contentDownload: 'content.download',
  writeupWrite: 'writeup.write',
  instanceOperate: 'instance.operate',
  contestManage: 'contest.manage',
  contestJudge: 'contest.judge',
  userManage: 'user.manage',
  roleManage: 'role.manage',
  platformSettingsManage: 'platform.settings.manage',
  globalOperationsManage: 'platform.operations.manage',
} as const

export type IdentityCapability = typeof identityCapability[keyof typeof identityCapability]

const playerCapabilities = [
  identityCapability.publicBrowse,
  identityCapability.accountRead,
  identityCapability.accountWrite,
  identityCapability.verificationResend,
  identityCapability.logout,
  identityCapability.teamWrite,
  identityCapability.contestRegister,
  identityCapability.flagSubmit,
  identityCapability.contentDownload,
  identityCapability.writeupWrite,
  identityCapability.instanceOperate,
] as const

export const globalRoleCapabilities: Readonly<Record<SessionSubject['role'], ReadonlySet<IdentityCapability>>> = {
  user: new Set(playerCapabilities),
  organizer: new Set([
    ...playerCapabilities,
    identityCapability.contestManage,
    identityCapability.contestJudge,
  ]),
  admin: new Set([
    ...playerCapabilities,
    identityCapability.contestManage,
    identityCapability.contestJudge,
    identityCapability.userManage,
    identityCapability.roleManage,
    identityCapability.platformSettingsManage,
    identityCapability.globalOperationsManage,
  ]),
}

const unverifiedCapabilities = new Set<IdentityCapability>([
  identityCapability.publicBrowse,
  identityCapability.accountRead,
  identityCapability.accountWrite,
  identityCapability.verificationResend,
  identityCapability.logout,
])

export class IdentityCapabilityError extends Error {
  constructor(readonly code:
    | 'identity.email_verification_required'
    | 'identity.account_setup_required'
    | 'identity.capability_forbidden') {
    const messages = {
      'identity.email_verification_required': '请先验证邮箱',
      'identity.account_setup_required': '请先完成账号安全设置',
      'identity.capability_forbidden': '当前账号无权执行此操作',
    } as const
    super(messages[code])
    this.name = 'IdentityCapabilityError'
  }
}

export function hasIdentityCapability(subject: SessionSubject, capability: IdentityCapability): boolean {
  return globalRoleCapabilities[subject.role].has(capability)
}

export function requireIdentityCapability(subject: SessionSubject, capability: IdentityCapability): void {
  if (subject.mustChangePassword && !unverifiedCapabilities.has(capability)) {
    throw new IdentityCapabilityError('identity.account_setup_required')
  }
  if (!subject.emailVerified && !unverifiedCapabilities.has(capability)) {
    throw new IdentityCapabilityError('identity.email_verification_required')
  }
  if (!hasIdentityCapability(subject, capability)) {
    throw new IdentityCapabilityError('identity.capability_forbidden')
  }
}
