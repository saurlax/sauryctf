import { describe, expect, it } from 'vitest'
import {
  adminUserListResponseSchema,
  changeUserStatusRequestSchema,
  changeGlobalRoleRequestSchema,
  changeEmailRequestSchema,
  changePasswordRequestSchema,
  emailVerificationConfirmRequestSchema,
  emailChangedSchema,
  emailVerifiedSchema,
  globalRoleChangedSchema,
  globalRoleSchema,
  identitySessionResponseSchema,
  loginIdentityRequestSchema,
  managedUserStatusSchema,
  passwordChangedSchema,
  passwordResetAcceptedSchema,
  passwordResetConfirmRequestSchema,
  passwordResetRequestSchema,
  publicPasswordResetResponse,
  registerIdentityRequestSchema,
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
    expect(changeEmailRequestSchema.parse({ email: 'operator@example.test' }))
      .toEqual({ email: 'operator@example.test' })
    expect(() => changeEmailRequestSchema.parse({ email: 'not-an-email' })).toThrow()
    expect(() => passwordResetRequestSchema.parse({
      email: 'player@example.test',
      disclose_account: true,
    })).toThrow()
  })

  it('keeps mutation responses free of session and token material', () => {
    expect(passwordChangedSchema.parse({ changed: true })).toEqual({ changed: true })
    expect(emailVerifiedSchema.parse({ verified: true })).toEqual({ verified: true })
    expect(emailChangedSchema.parse({ changed: true })).toEqual({ changed: true })
    expect(() => passwordChangedSchema.parse({ changed: true, session_version: 2 })).toThrow()
    expect(() => emailVerifiedSchema.parse({ verified: true, token: 'secret' })).toThrow()
  })

  it('accepts only the three global roles and returns the invalidated session version', () => {
    expect(globalRoleSchema.options).toEqual(['user', 'organizer', 'admin'])
    expect(changeGlobalRoleRequestSchema.parse({
      role: 'organizer',
      reason: 'Assign contest operations',
    })).toEqual({ role: 'organizer', reason: 'Assign contest operations' })
    expect(() => changeGlobalRoleRequestSchema.parse({ role: 'organizer' })).toThrow()
    expect(() => changeGlobalRoleRequestSchema.parse({ role: 'judge', reason: 'Invalid legacy role' })).toThrow()
    expect(globalRoleChangedSchema.parse({
      user_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f2d',
      previous_role: 'user',
      role: 'organizer',
      session_version: 2,
      changed: true,
    })).toMatchObject({ role: 'organizer', session_version: 2 })
  })

  it('defines the new browser identity and user-management projections without legacy roles', () => {
    expect(registerIdentityRequestSchema.parse({
      username: 'PlayerOne',
      email: 'player@example.test',
      password: 'password value',
    })).toMatchObject({ username: 'PlayerOne' })
    expect(loginIdentityRequestSchema.parse({ identifier: 'PlayerOne', password: 'password value' }))
      .toMatchObject({ identifier: 'PlayerOne' })
    expect(managedUserStatusSchema.options).toEqual(['active', 'banned'])
    expect(changeUserStatusRequestSchema.parse({
      status: 'banned',
      reason: 'Confirmed account abuse',
    })).toEqual({ status: 'banned', reason: 'Confirmed account abuse' })
    expect(() => changeUserStatusRequestSchema.parse({ status: 'banned', reason: '  ' })).toThrow()

    const user = {
      id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f2d',
      username: 'PlayerOne',
      email: 'player@example.test',
      email_verified: false,
      status: 'active' as const,
      role: 'user' as const,
      session_version: 1,
      must_change_password: false,
    }
    expect(identitySessionResponseSchema.parse({ user })).toEqual({ user })
    expect(adminUserListResponseSchema.parse({
      items: [{ ...user, created_at: '2026-09-01T08:00:00.000Z' }],
      page: { next_cursor: null, has_more: false },
    }).items).toHaveLength(1)
  })
})
