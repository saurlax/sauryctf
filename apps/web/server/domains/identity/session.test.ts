import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import type {
  IdentityRepository,
  NewIdentity,
  RegisteredIdentity,
  SessionSubject,
  StoredIdentity,
} from './repository'
import { describe, expect, it } from 'vitest'
import { IdentitySessionService } from './session'

const session: AuthSessionData = {
  user_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c',
  session_version: 3,
  logged_in_at: '2026-09-01T07:08:09.123Z',
}

class SessionRepository implements IdentityRepository {
  subject: SessionSubject | null = {
    userId: session.user_id,
    username: 'Player',
    email: 'player@example.test',
    emailVerified: false,
    status: 'active',
    role: 'organizer',
    sessionVersion: 3,
    mustChangePassword: false,
  }

  async findSessionSubject(): Promise<SessionSubject | null> { return this.subject }
  async createIdentity(_identity: NewIdentity): Promise<RegisteredIdentity> { throw new Error('not used') }
  async findByLoginIdentifier(_identifier: string): Promise<StoredIdentity | null> { throw new Error('not used') }
  async findCredential(): Promise<never> { throw new Error('not used') }
  async findPasswordResetRecipient(): Promise<never> { throw new Error('not used') }
  async replacePasswordHash(): Promise<boolean> { throw new Error('not used') }
  async changePassword(): Promise<never> { throw new Error('not used') }
  async resetPassword(): Promise<never> { throw new Error('not used') }
  async issueEmailToken(): Promise<never> { throw new Error('not used') }
  async verifyEmail(): Promise<never> { throw new Error('not used') }
}

describe('protected identity session validation', () => {
  it('loads current email and role state from authority storage', async () => {
    const repository = new SessionRepository()
    const principal = await new IdentitySessionService(repository).validate(session)
    expect(principal).toMatchObject({
      emailVerified: false,
      role: 'organizer',
      sessionVersion: 3,
    })
  })

  it.each([
    ['deleted', null],
    ['banned', { status: 'banned' }],
    ['stale version', { sessionVersion: 4 }],
  ])('rejects a %s account session', async (_case, change) => {
    const repository = new SessionRepository()
    repository.subject = change === null ? null : { ...repository.subject!, ...change } as SessionSubject
    await expect(new IdentitySessionService(repository).validate(session))
      .rejects.toMatchObject({ name: 'InvalidIdentitySessionError' })
  })
})
