import { DeferredIdentityTokenDelivery } from '../domains/identity/delivery'
import { IdentityService } from '../domains/identity/service'
import { IdentitySessionService } from '../domains/identity/session'
import { DisabledHumanVerificationProvider } from '../domains/identity/human-verification'
import { identityTokenCodec } from '../infrastructure/auth/identity-token-codec'
import { nuxtPasswordHasher } from '../infrastructure/auth/nuxt-password-hasher'
import { TurnstileHumanVerificationProvider } from '../infrastructure/auth/turnstile'
import { createDatabaseClient } from '../infrastructure/db/client'
import { PostgresIdentityRepository } from '../infrastructure/db/identity-repository'
import { ResilientRedisRateLimitStore } from '../infrastructure/security/rate-limit'
import type { ControlPlaneServices } from '../services'

export default defineNitroPlugin((nitroApp) => {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return

  const database = createDatabaseClient({
    connectionString: databaseUrl,
    applicationName: 'sauryctf-control-plane',
  })
  const identityRepository = new PostgresIdentityRepository(database.pool)
  const rateLimits = new ResilientRedisRateLimitStore(process.env.REDIS_URL)
  const humanVerification = process.env.TURNSTILE_SECRET_KEY
    ? new TurnstileHumanVerificationProvider(process.env.TURNSTILE_SECRET_KEY)
    : new DisabledHumanVerificationProvider()
  const services: ControlPlaneServices = {
    identity: new IdentityService(identityRepository, nuxtPasswordHasher, identityTokenCodec),
    identitySessions: new IdentitySessionService(identityRepository),
    identityTokenDelivery: new DeferredIdentityTokenDelivery(),
    humanVerification,
    rateLimits,
  }

  nitroApp.hooks.hook('request', (event) => {
    event.context.services = services
  })
  nitroApp.hooks.hook('close', async () => {
    await rateLimits.close()
    await database.pool.end()
  })
})
