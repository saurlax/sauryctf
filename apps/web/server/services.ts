import type { IdentityService } from './domains/identity/service'
import type { IdentitySessionService } from './domains/identity/session'
import type { HumanVerificationProvider } from './domains/identity/human-verification'
import type { RateLimitStore } from './infrastructure/security/rate-limit'
import type { TeamService } from './domains/teams/service'
import type { ParticipationService } from './domains/participations/service'
import type { ContestService } from './domains/contests/service'

export interface ControlPlaneServices {
  identity: IdentityService
  identitySessions: IdentitySessionService
  humanVerification: HumanVerificationProvider
  rateLimits: RateLimitStore
  teams: TeamService
  participations: ParticipationService
  contests: ContestService
}
