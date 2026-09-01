import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import type { IdentityRepository, SessionSubject } from './repository'

export class InvalidIdentitySessionError extends Error {
  constructor() {
    super('当前登录状态已失效')
    this.name = 'InvalidIdentitySessionError'
  }
}

export interface IdentitySessionValidator {
  validate(session: AuthSessionData): Promise<SessionSubject>
}

export class IdentitySessionService implements IdentitySessionValidator {
  constructor(private readonly repository: IdentityRepository) {}

  async validate(session: AuthSessionData): Promise<SessionSubject> {
    const subject = await this.repository.findSessionSubject(session.user_id)
    if (!subject || subject.status !== 'active' || subject.sessionVersion !== session.session_version) {
      throw new InvalidIdentitySessionError()
    }
    return subject
  }
}
