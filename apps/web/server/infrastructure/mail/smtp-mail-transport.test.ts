import { describe, expect, it, vi } from 'vitest'
import { AesGcmIdentityMailTokenProtector } from '../auth/identity-mail-token-protector'
import { SmtpMailTransport } from './smtp-mail-transport'

describe('SMTP security mail transport', () => {
  it('reveals a protected token only into the outbound message body', async () => {
    const protector = new AesGcmIdentityMailTokenProtector('smtp-test-secret-that-is-at-least-thirty-two-characters')
    const token = 'raw-reset-token'
    const envelope = protector.protect(token)
    const sendMail = vi.fn(async () => ({ messageId: 'accepted' }))
    const transport = new SmtpMailTransport({
      host: '127.0.0.1',
      port: 1025,
      from: 'SauryCTF <noreply@example.test>',
      siteUrl: 'https://ctf.example.test',
    }, protector, { sendMail })

    await transport.send({
      id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f40',
      recipient: 'player@example.test',
      templateKey: 'identity.password_reset_requested',
      payload: { token_envelope: envelope },
      attemptCount: 1,
      maxAttempts: 8,
      messageId: '<018f47a2-4ef8-7e2c-9c24-6d68b7451f40@mail.sauryctf>',
    })

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'player@example.test',
      messageId: '<018f47a2-4ef8-7e2c-9c24-6d68b7451f40@mail.sauryctf>',
      text: expect.stringContaining(encodeURIComponent(token)),
    }))
    expect(JSON.stringify(sendMail.mock.calls)).not.toContain(envelope)
  })

  it('uses the current platform brand and English default locale', async () => {
    const protector = new AesGcmIdentityMailTokenProtector('smtp-test-secret-that-is-at-least-thirty-two-characters')
    const sendMail = vi.fn(async () => ({ messageId: 'accepted' }))
    const transport = new SmtpMailTransport({
      host: '127.0.0.1',
      port: 1025,
      from: 'Arena <noreply@example.test>',
      siteUrl: 'https://ctf.example.test',
      presentation: async () => ({ brandName: 'Arena', locale: 'en' }),
    }, protector, { sendMail })

    await transport.send({
      id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f41',
      recipient: 'player@example.test',
      templateKey: 'identity.password_changed',
      payload: {},
      attemptCount: 1,
      maxAttempts: 8,
      messageId: '<018f47a2-4ef8-7e2c-9c24-6d68b7451f41@mail.sauryctf>',
    })

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Arena: Password changed',
      text: expect.stringContaining('If this was not you'),
    }))
  })
})
