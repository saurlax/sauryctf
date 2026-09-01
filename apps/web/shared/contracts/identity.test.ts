import { describe, expect, it } from 'vitest'
import {
  changePasswordRequestSchema,
  emailVerificationConfirmRequestSchema,
  emailVerifiedSchema,
  passwordChangedSchema,
  passwordResetAcceptedSchema,
  passwordResetConfirmRequestSchema,
  passwordResetRequestSchema,
  publicPasswordResetResponse,
} from './identity'

describe('password reset anti-enumeration response', () => {
  it('has one stable response without recipient or token fields', () => {
    const response = passwordResetAcceptedSchema.parse(publicPasswordResetResponse())
    expect(response).toEqual({ accepted: true })
    expect(response).not.toHaveProperty('delivery')
    expect(response).not.toHaveProperty('token')
    expect(response).not.toHaveProperty('user_id')
  })

  it('validates credential mutation inputs and rejects undeclared fields', () => {
    expect(changePasswordRequestSchema.parse({
      current_password: 'old password',
      new_password: 'new password',
    })).toBeTruthy()
    expect(passwordResetRequestSchema.parse({ email: 'player@example.test' })).toBeTruthy()
    expect(passwordResetConfirmRequestSchema.parse({
      token: 'a'.repeat(43),
      new_password: 'new password',
    })).toBeTruthy()
    expect(emailVerificationConfirmRequestSchema.parse({ token: 'b'.repeat(43) })).toBeTruthy()
    expect(() => passwordResetRequestSchema.parse({
      email: 'player@example.test',
      disclose_account: true,
    })).toThrow()
  })

  it('keeps mutation responses free of session and token material', () => {
    expect(passwordChangedSchema.parse({ changed: true })).toEqual({ changed: true })
    expect(emailVerifiedSchema.parse({ verified: true })).toEqual({ verified: true })
    expect(() => passwordChangedSchema.parse({ changed: true, session_version: 2 })).toThrow()
    expect(() => emailVerifiedSchema.parse({ verified: true, token: 'secret' })).toThrow()
  })
})
