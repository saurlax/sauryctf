import type { IdentityTokenDelivery } from './domains/identity/delivery'
import type { IdentityService } from './domains/identity/service'
import type { IdentitySessionService } from './domains/identity/session'
import type { HumanVerificationProvider } from './domains/identity/human-verification'
import type { RateLimitStore } from './infrastructure/security/rate-limit'

export interface ControlPlaneServices {
  identity: IdentityService
  identitySessions: IdentitySessionService
  identityTokenDelivery: IdentityTokenDelivery
  humanVerification: HumanVerificationProvider
  rateLimits: RateLimitStore
}
