import { describe, expect, it } from 'vitest'
import { AesGcmIdentityMailTokenProtector } from './identity-mail-token-protector'

describe('identity mail token envelope', () => {
  it('round-trips without storing the raw token and rejects tampering', () => {
    const protector = new AesGcmIdentityMailTokenProtector('test-secret-that-is-longer-than-thirty-two-characters')
    const token = 'sensitive-identity-token'
    const envelope = protector.protect(token)

    expect(envelope).not.toContain(token)
    expect(protector.reveal(envelope)).toBe(token)

    const tamperIndex = Math.floor(envelope.length / 2)
    const tampered = `${envelope.slice(0, tamperIndex)}${envelope[tamperIndex] === 'a' ? 'b' : 'a'}${envelope.slice(tamperIndex + 1)}`
    expect(() => protector.reveal(tampered)).toThrow()
  })
})
