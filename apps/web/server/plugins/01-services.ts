import { randomUUID } from 'node:crypto'
import { IdentityService } from '../domains/identity/service'
import { IdentitySessionService } from '../domains/identity/session'
import { MailOutboxDispatcher } from '../domains/notifications/mail-outbox'
import { DisabledHumanVerificationProvider } from '../domains/identity/human-verification'
import { identityTokenCodec } from '../infrastructure/auth/identity-token-codec'
import { AesGcmIdentityMailTokenProtector } from '../infrastructure/auth/identity-mail-token-protector'
import { nuxtPasswordHasher } from '../infrastructure/auth/nuxt-password-hasher'
import { TurnstileHumanVerificationProvider } from '../infrastructure/auth/turnstile'
import { createDatabaseClient } from '../infrastructure/db/client'
import { PostgresIdentityRepository } from '../infrastructure/db/identity-repository'
import { PostgresMailOutboxRepository } from '../infrastructure/mail/postgres-mail-outbox'
import { SmtpMailTransport } from '../infrastructure/mail/smtp-mail-transport'
import { ResilientRedisRateLimitStore } from '../infrastructure/security/rate-limit'
import { structuredLog } from '../infrastructure/telemetry/logging'
import type { ControlPlaneServices } from '../services'
import { TeamService } from '../domains/teams/service'
import { PostgresTeamRepository } from '../infrastructure/db/team-repository'
import { ParticipationService } from '../domains/participations/service'
import { PostgresParticipationRepository } from '../infrastructure/db/participation-repository'
import { ContestService } from '../domains/contests/service'
import { PostgresContestRepository } from '../infrastructure/db/contest-repository'
import { AnnouncementService } from '../domains/announcements/service'
import { PostgresAnnouncementRepository } from '../infrastructure/db/announcement-repository'
import { PublicTimelineService } from '../domains/timeline/service'
import { PostgresPublicTimelineRepository } from '../infrastructure/db/public-timeline-repository'
import { ChallengeTemplateService } from '../domains/challenges/service'
import { PostgresChallengeTemplateRepository } from '../infrastructure/db/challenge-template-repository'
import { ContestChallengeService } from '../domains/challenges/contest-challenge-service'
import { PostgresContestChallengeRepository } from '../infrastructure/db/contest-challenge-repository'
import { FlagVerifier, VersionedFlagKeyring } from '../domains/challenges/flag-verifier'
import { SubmissionService } from '../domains/submissions/service'
import { PostgresSubmissionRepository } from '../infrastructure/db/submission-repository'
import { RateLimitStoreSubmissionLimiter } from '../infrastructure/security/submission-rate-limiter'

export default defineNitroPlugin(async (nitroApp) => {
  const databaseUrl = process.env.DATABASE_URL
  const sessionPassword = process.env.NUXT_SESSION_PASSWORD
  if (!databaseUrl || !sessionPassword) return

  const database = createDatabaseClient({
    connectionString: databaseUrl,
    applicationName: 'sauryctf-control-plane',
  })
  const identityRepository = new PostgresIdentityRepository(database.pool)
  const rateLimits = new ResilientRedisRateLimitStore(process.env.REDIS_URL)
  const humanVerification = process.env.TURNSTILE_SECRET_KEY
    ? new TurnstileHumanVerificationProvider(process.env.TURNSTILE_SECRET_KEY)
    : new DisabledHumanVerificationProvider()
  const mailTokens = new AesGcmIdentityMailTokenProtector(sessionPassword)
  const identity = new IdentityService(
    identityRepository,
    nuxtPasswordHasher,
    identityTokenCodec,
    undefined,
    mailTokens,
  )
  await identity.bootstrapDefaultAdministrator()
  const services: ControlPlaneServices = {
    identity,
    identitySessions: new IdentitySessionService(identityRepository),
    humanVerification,
    rateLimits,
    teams: new TeamService(new PostgresTeamRepository(database.pool)),
    participations: new ParticipationService(new PostgresParticipationRepository(database.pool)),
    contests: new ContestService(new PostgresContestRepository(database.pool)),
    announcements: new AnnouncementService(new PostgresAnnouncementRepository(database.pool)),
    timeline: new PublicTimelineService(new PostgresPublicTimelineRepository(database.pool)),
    challengeTemplates: new ChallengeTemplateService(new PostgresChallengeTemplateRepository(database.pool)),
    contestChallenges: new ContestChallengeService(new PostgresContestChallengeRepository(database.pool)),
    submissions: new SubmissionService(
      new PostgresSubmissionRepository(database.pool),
      new FlagVerifier(new VersionedFlagKeyring({})),
      new RateLimitStoreSubmissionLimiter(rateLimits),
    ),
  }

  const smtpHost = process.env.MAIL_SMTP_HOST
  const mailFrom = process.env.MAIL_FROM
  const publicOrigin = process.env.PUBLIC_ORIGIN
  let dispatchTimer: ReturnType<typeof setInterval> | undefined
  if (smtpHost && mailFrom && publicOrigin) {
    const smtpPort = Number.parseInt(process.env.MAIL_SMTP_PORT ?? '25', 10)
    const dispatcher = new MailOutboxDispatcher(
      `control-plane-${randomUUID()}`,
      new PostgresMailOutboxRepository(database.pool),
      new SmtpMailTransport({
        host: smtpHost,
        port: Number.isSafeInteger(smtpPort) && smtpPort > 0 ? smtpPort : 25,
        secure: process.env.MAIL_SMTP_SECURE === 'true',
        username: process.env.MAIL_SMTP_USERNAME,
        password: process.env.MAIL_SMTP_PASSWORD,
        from: mailFrom,
        publicOrigin,
      }, mailTokens),
    )
    let dispatching = false
    const dispatch = async () => {
      if (dispatching) return
      dispatching = true
      try {
        await dispatcher.runOnce()
      }
      catch (error) {
        console.error(structuredLog('error', 'mail.dispatch_failed', { error }))
      }
      finally {
        dispatching = false
      }
    }
    void dispatch()
    dispatchTimer = setInterval(() => void dispatch(), 2_000)
    dispatchTimer.unref()
  }

  nitroApp.hooks.hook('request', (event) => {
    event.context.services = services
  })
  nitroApp.hooks.hook('close', async () => {
    if (dispatchTimer) clearInterval(dispatchTimer)
    await rateLimits.close()
    await database.pool.end()
  })
})
