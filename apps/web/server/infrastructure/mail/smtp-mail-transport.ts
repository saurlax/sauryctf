import nodemailer from 'nodemailer'
import type { PlatformLocale } from '../../../shared/contracts/platform-settings'
import { renderSystemMailTemplate } from '../../../shared/i18n/mail-templates'
import { isPlatformLocale } from '../../../shared/i18n/system'
import type { IdentityMailTokenProtector } from '../../domains/identity/delivery'
import type { MailTransport, MailTransportMessage } from '../../domains/notifications/mail-outbox'

export interface SmtpMailTransportOptions {
  host: string
  port: number
  secure?: boolean
  username?: string
  password?: string
  from: string
  siteUrl: string
  presentation?: () => Promise<{ brandName: string, locale: PlatformLocale }>
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
    const rendered = await this.render(message)
    await this.transporter.sendMail({
      from: this.options.from,
      to: message.recipient,
      messageId: message.messageId,
      subject: rendered.subject,
      text: rendered.text,
    })
  }

  private async render(message: MailTransportMessage): Promise<RenderedMail> {
    const configured = await this.options.presentation?.() ?? { brandName: 'SauryCTF', locale: 'zh-CN' as const }
    const locale = isPlatformLocale(message.payload.locale) ? message.payload.locale : configured.locale
    const tokenEnvelope = message.payload.token_envelope
    if (message.templateKey === 'identity.email_verification_requested') {
      const token = this.revealToken(tokenEnvelope)
      const link = `${this.options.siteUrl}/verify-email?token=${encodeURIComponent(token)}`
      return renderSystemMailTemplate(message.templateKey, { ...configured, locale, link })
    }
    if (message.templateKey === 'identity.password_reset_requested') {
      const token = this.revealToken(tokenEnvelope)
      const link = `${this.options.siteUrl}/reset-password?token=${encodeURIComponent(token)}`
      return renderSystemMailTemplate(message.templateKey, { ...configured, locale, link })
    }
    return renderSystemMailTemplate(message.templateKey, { ...configured, locale })
  }

  private revealToken(value: unknown): string {
    if (typeof value !== 'string') throw new Error('InvalidMailTokenEnvelope')
    return this.mailTokens.reveal(value)
  }
}
