import nodemailer from 'nodemailer'
import type { IdentityMailTokenProtector } from '../../domains/identity/delivery'
import type { MailTransport, MailTransportMessage } from '../../domains/notifications/mail-outbox'

export interface SmtpMailTransportOptions {
  host: string
  port: number
  secure?: boolean
  username?: string
  password?: string
  from: string
  publicOrigin: string
}

interface RenderedMail {
  subject: string
  text: string
}

interface SmtpClient {
  sendMail(options: {
    from: string
    to: string
    messageId: string
    subject: string
    text: string
  }): Promise<unknown>
}

export class SmtpMailTransport implements MailTransport {
  private readonly transporter: SmtpClient

  constructor(
    private readonly options: SmtpMailTransportOptions,
    private readonly mailTokens: IdentityMailTokenProtector,
    transporter?: SmtpClient,
  ) {
    const nodemailerTransport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure ?? false,
      auth: options.username
        ? { user: options.username, pass: options.password ?? '' }
        : undefined,
    })
    this.transporter = transporter ?? {
      sendMail: mail => nodemailerTransport.sendMail(mail),
    }
  }

  async send(message: MailTransportMessage): Promise<void> {
    const rendered = this.render(message)
    await this.transporter.sendMail({
      from: this.options.from,
      to: message.recipient,
      messageId: message.messageId,
      subject: rendered.subject,
      text: rendered.text,
    })
  }

  private render(message: MailTransportMessage): RenderedMail {
    const tokenEnvelope = message.payload.token_envelope
    if (message.templateKey === 'identity.email_verification_requested') {
      const token = this.revealToken(tokenEnvelope)
      const link = `${this.options.publicOrigin}/verify-email?token=${encodeURIComponent(token)}`
      return { subject: '验证 SauryCTF 邮箱', text: `请打开以下链接验证邮箱：\n${link}` }
    }
    if (message.templateKey === 'identity.password_reset_requested') {
      const token = this.revealToken(tokenEnvelope)
      const link = `${this.options.publicOrigin}/reset-password?token=${encodeURIComponent(token)}`
      return { subject: '重置 SauryCTF 密码', text: `请打开以下链接重置密码：\n${link}` }
    }

    const securitySubjects: Record<string, string> = {
      'identity.password_changed': 'SauryCTF 密码已变更',
      'identity.email_changed': 'SauryCTF 邮箱已变更',
      'identity.email_verified': 'SauryCTF 邮箱已验证',
      'identity.role_changed': 'SauryCTF 账号角色已变更',
      'identity.account_banned': 'SauryCTF 账号状态已变更',
    }
    const subject = securitySubjects[message.templateKey]
    if (!subject) throw new Error('UnsupportedMailTemplate')
    return { subject, text: `${subject}。如非本人操作，请立即联系平台管理员。` }
  }

  private revealToken(value: unknown): string {
    if (typeof value !== 'string') throw new Error('InvalidMailTokenEnvelope')
    return this.mailTokens.reveal(value)
  }
}
