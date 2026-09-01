import type { PlatformLocale } from '../contracts/platform-settings'

export interface MailTemplatePresentation {
  brandName: string
  locale: PlatformLocale
  link?: string
}

export interface RenderedMailTemplate {
  subject: string
  text: string
}

const securityActions: Record<string, { 'zh-CN': string, en: string }> = {
  'identity.password_changed': { 'zh-CN': '密码已变更', en: 'Password changed' },
  'identity.email_changed': { 'zh-CN': '邮箱已变更', en: 'Email changed' },
  'identity.email_verified': { 'zh-CN': '邮箱已验证', en: 'Email verified' },
  'identity.role_changed': { 'zh-CN': '账号角色已变更', en: 'Account role changed' },
  'identity.account_banned': { 'zh-CN': '账号状态已变更', en: 'Account status changed' },
  'identity.account_reactivated': { 'zh-CN': '账号状态已恢复', en: 'Account status restored' },
}

export function renderSystemMailTemplate(
  templateKey: string,
  presentation: MailTemplatePresentation,
): RenderedMailTemplate {
  const { brandName, locale, link } = presentation
  if (templateKey === 'identity.email_verification_requested') {
    if (!link) throw new Error('MissingMailTemplateLink')
    return locale === 'en'
      ? { subject: `Verify your ${brandName} email`, text: `Open this link to verify your email:\n${link}` }
      : { subject: `验证 ${brandName} 邮箱`, text: `请打开以下链接验证邮箱：\n${link}` }
  }
  if (templateKey === 'identity.password_reset_requested') {
    if (!link) throw new Error('MissingMailTemplateLink')
    return locale === 'en'
      ? { subject: `Reset your ${brandName} password`, text: `Open this link to reset your password:\n${link}` }
      : { subject: `重置 ${brandName} 密码`, text: `请打开以下链接重置密码：\n${link}` }
  }

  const action = securityActions[templateKey]
  if (!action) throw new Error('UnsupportedMailTemplate')
  const subject = locale === 'en' ? `${brandName}: ${action.en}` : `${brandName} ${action['zh-CN']}`
  const text = locale === 'en'
    ? `${subject}. If this was not you, contact the platform administrator immediately.`
    : `${subject}。如非本人操作，请立即联系平台管理员。`
  return { subject, text }
}
