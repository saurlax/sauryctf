import { describe, expect, it, vi } from 'vitest'
import type { IdentityRepository, SessionSubject } from '../../domains/identity/repository'
import { IdentitySessionService } from '../../domains/identity/session'
import { resolveProtectedIdentity } from './protected-session'

function repositoryFor(subject: SessionSubject | null): IdentityRepository {
  return {
    createIdentity: vi.fn(),
    bootstrapDefaultAdministrator: vi.fn(),
    findByLoginIdentifier: vi.fn(),
    findCredential: vi.fn(),
    findPasswordResetRecipient: vi.fn(),
    findSessionSubject: vi.fn().mockResolvedValue(subject),
    replacePasswordHash: vi.fn(),
    changePassword: vi.fn(),
    resetPassword: vi.fn(),
    issueEmailToken: vi.fn(),
    verifyEmail: vi.fn(),
    changeGlobalRole: vi.fn(),
    changeEmail: vi.fn(),
  }
}

const validSession = {
  user_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c',
  session_version: 3,
  logged_in_at: '2026-09-01T07:08:09.123Z',
}

describe('protected session cookie adapter', () => {
  it.each([
    ['malformed', { ...validSession, role: 'admin' }, null],
    ['deleted', validSession, null],
    ['banned', validSession, { status: 'banned', sessionVersion: 3 }],
    ['stale', validSession, { status: 'active', sessionVersion: 4 }],
  ])('clears a %s session cookie', async (_case, data, partialSubject) => {
    const clear = vi.fn().mockResolvedValue(undefined)
    const subject = partialSubject === null ? null : {
      userId: validSession.user_id,
      username: 'Player',
      email: 'player@example.test',
      emailVerified: true,
      role: 'user',
      mustChangePassword: false,
      ...partialSubject,
    } as SessionSubject
    const service = new IdentitySessionService(repositoryFor(subject))

    await expect(resolveProtectedIdentity({
      read: vi.fn().mockResolvedValue(data),
      clear,
    }, service)).rejects.toMatchObject({ statusCode: 401 })
    expect(clear).toHaveBeenCalledOnce()
  })
})
