import { describe, expect, it } from 'vitest'
import { structuredLog } from './logging'

describe('structured log redaction', () => {
  it('redacts nested credentials, cookies, flags and answers', () => {
    const log = structuredLog('error', 'request.failed', {
      request_id: 'request-id',
      authorization: 'Bearer token-value',
      request: {
        password: 'password-value',
        submitted_flag: 'flag{secret-value}',
        safe: 'visible',
      },
      cookie: 'session-value',
    })

    expect(log).toContain('visible')
    expect(log).toContain('[REDACTED]')
    expect(log).not.toContain('token-value')
    expect(log).not.toContain('password-value')
    expect(log).not.toContain('flag{secret-value}')
    expect(log).not.toContain('session-value')
  })
})
