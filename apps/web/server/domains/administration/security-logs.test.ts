import { describe, expect, it } from 'vitest'
import { isSecurityLogErrorCode } from './security-logs'

describe('security log classification', () => {
  it('persists authentication abuse and security enforcement outcomes only', () => {
    expect(isSecurityLogErrorCode('security.csrf_invalid')).toBe(true)
    expect(isSecurityLogErrorCode('security.rate_limited')).toBe(true)
    expect(isSecurityLogErrorCode('identity.invalid_credentials')).toBe(true)
    expect(isSecurityLogErrorCode('identity.session_invalid')).toBe(true)
    expect(isSecurityLogErrorCode('identity.capability_forbidden')).toBe(true)
    expect(isSecurityLogErrorCode('contest.not_found')).toBe(false)
    expect(isSecurityLogErrorCode('request.validation_failed')).toBe(false)
  })
})
