import { describe, expect, it, vi } from 'vitest'
import { TurnstileHumanVerificationProvider } from './turnstile'

describe('Turnstile provider', () => {
  it('submits the secret server-side and requires the expected action', async () => {
    const fetcherMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      success: true,
      action: 'password_reset',
    }), { status: 200 }))
    const fetcher = fetcherMock as unknown as typeof fetch
    const provider = new TurnstileHumanVerificationProvider(
      'server-secret',
      fetcher,
      'https://turnstile.example.test/siteverify',
    )

    await expect(provider.verify({
      token: 'browser-token',
      remoteIp: '192.0.2.20',
      action: 'password_reset',
    })).resolves.toBe(true)
    const request = fetcherMock.mock.calls[0]![1]!
    const body = request.body as URLSearchParams
    expect(body.get('secret')).toBe('server-secret')
    expect(body.get('response')).toBe('browser-token')
    expect(body.get('remoteip')).toBe('192.0.2.20')
  })

  it('rejects action mismatch, upstream errors, and malformed responses', async () => {
    const mismatch = new TurnstileHumanVerificationProvider('secret', async () => new Response(JSON.stringify({
      success: true,
      action: 'login',
    })))
    const unavailable = new TurnstileHumanVerificationProvider('secret', async () => {
      throw new Error('unavailable')
    })
    const malformed = new TurnstileHumanVerificationProvider('secret', async () => new Response('{}'))
    const input = { token: 'token', action: 'password_reset' }
    await expect(mismatch.verify(input)).resolves.toBe(false)
    await expect(unavailable.verify(input)).resolves.toBe(false)
    await expect(malformed.verify(input)).resolves.toBe(false)
  })
})
