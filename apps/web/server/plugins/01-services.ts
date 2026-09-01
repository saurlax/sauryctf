import { randomUUID } from 'node:crypto'
import { DomainOutboxDispatcher } from '../domains/events/domain-outbox'
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
import { AesGcmSubmissionAnswerProtector } from '../infrastructure/security/submission-answer-protector'
import { ContestScoringReplayService } from '../domains/submissions/scoring-replay'
import { ScoreboardBuildCoordinator } from '../domains/scoreboards/build-coordinator'
import { ScoreboardViewService } from '../domains/scoreboards/view-service'
import { ResilientRedisScoreboardBuildLock } from '../infrastructure/cache/redis-scoreboard-build-lock'
import { ResilientRedisScoreboardCache } from '../infrastructure/cache/redis-scoreboard-cache'
import { PostgresScoringReplayRepository } from '../infrastructure/db/scoring-replay-repository'
import { PostgresScoreboardViewRepository } from '../infrastructure/db/scoreboard-view-repository'
import { PostgresDomainOutboxRepository } from '../infrastructure/db/domain-outbox-repository'
import { RedisDomainEventPublisher } from '../infrastructure/events/redis-domain-event-publisher'
import { RedisPublicRealtimeLog } from '../infrastructure/events/redis-public-realtime-log'
import { ContentObjectService } from '../domains/content/service'
import { ContentDownloadService } from '../domains/content/download-service'
import { PostgresContentObjectRepository } from '../infrastructure/db/content-object-repository'
import { PostgresContentDownloadRepository } from '../infrastructure/db/content-download-repository'
import { S3ContentObjectStore } from '../infrastructure/storage/s3-content-object-store'
import { WriteupService } from '../domains/writeups/service'
import { PostgresWriteupRepository } from '../infrastructure/db/writeup-repository'
import { ZipWriteupArchiveBuilder } from '../infrastructure/content/writeup-zip'
import { ContestPackageService } from '../domains/contest-packages/service'
import { PostgresContestPackageRepository } from '../infrastructure/db/contest-package-repository'
import { ContestPackageArchiveCodec } from '../infrastructure/content/contest-package-archive'
import { PlatformSettingsService } from '../domains/platform-settings/service'
import { PostgresPlatformSettingsRepository } from '../infrastructure/db/platform-settings-repository'

export default defineNitroPlugin(async (nitroApp) => {
  const databaseUrl = process.env.DATABASE_URL
  const sessionPassword = process.env.NUXT_SESSION_PASSWORD
  const submissionAnswerKey = process.env.SUBMISSION_ANSWER_KEY
  const s3Endpoint = process.env.S3_ENDPOINT
  const s3Region = process.env.S3_REGION
  const s3Bucket = process.env.S3_BUCKET
  const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID
  const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY
  if (!databaseUrl || !sessionPassword || !submissionAnswerKey
    || !s3Endpoint || !s3Region || !s3Bucket || !s3AccessKeyId || !s3SecretAccessKey) return

  const database = createDatabaseClient({
    connectionString: databaseUrl,
    applicationName: 'sauryctf-control-plane',
  })
  const identityRepository = new PostgresIdentityRepository(database.pool)
  const rateLimits = new ResilientRedisRateLimitStore(process.env.REDIS_URL)
  const scoreboardCache = new ResilientRedisScoreboardCache(process.env.REDIS_URL)
  const scoreboardBuildLock = new ResilientRedisScoreboardBuildLock(process.env.REDIS_URL)
  const domainEventPublisher = new RedisDomainEventPublisher(process.env.REDIS_URL)
  const publicRealtime = new RedisPublicRealtimeLog(process.env.REDIS_URL)
  const contentStore = new S3ContentObjectStore({
    endpoint: s3Endpoint,
    region: s3Region,
    bucket: s3Bucket,
    accessKeyId: s3AccessKeyId,
    secretAccessKey: s3SecretAccessKey,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  })
  const content = new ContentObjectService(
    new PostgresContentObjectRepository(database.pool),
    contentStore,
  )
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
  const scoringReplays = new ContestScoringReplayService(
    new PostgresScoringReplayRepository(database.pool),
  )
  const platformSettings = new PlatformSettingsService(
    new PostgresPlatformSettingsRepository(database.pool),
    content,
  )
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
      new AesGcmSubmissionAnswerProtector(Buffer.from(submissionAnswerKey, 'base64url')),
    ),
    scoreboards: new ScoreboardViewService(
      new PostgresScoreboardViewRepository(database.pool),
      scoringReplays,
      undefined,
      undefined,
      scoreboardCache,
      new ScoreboardBuildCoordinator(scoreboardBuildLock),
    ),
    publicRealtime,
    content,
    contentDownloads: new ContentDownloadService(
      new PostgresContentDownloadRepository(database.pool),
      contentStore,
    ),
    writeups: new WriteupService(
      new PostgresWriteupRepository(database.pool),
      new ZipWriteupArchiveBuilder(contentStore),
    ),
    contestPackages: new ContestPackageService(
      new PostgresContestPackageRepository(database.pool),
      content,
      new ContestPackageArchiveCodec(contentStore),
    ),
    platformSettings,
  }

  const smtpHost = process.env.MAIL_SMTP_HOST
  const mailFrom = process.env.MAIL_FROM
  const publicOrigin = process.env.PUBLIC_ORIGIN
  let dispatchTimer: ReturnType<typeof setInterval> | undefined
  let domainEventTimer: ReturnType<typeof setInterval> | undefined
  let contentCleanupTimer: ReturnType<typeof setInterval> | undefined
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
        presentation: async () => {
          const settings = await platformSettings.readPublic()
          return { brandName: settings.brandName, locale: settings.defaultLocale }
        },
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

  if (process.env.REDIS_URL) {
    const dispatcher = new DomainOutboxDispatcher(
      new PostgresDomainOutboxRepository(database.pool),
      domainEventPublisher,
    )
    let dispatching = false
    const dispatch = async () => {
      if (dispatching) return
      dispatching = true
      try {
        await dispatcher.runOnce()
      }
      catch (error) {
        console.error(structuredLog('error', 'domain_events.dispatch_failed', { error }))
      }
      finally {
        dispatching = false
      }
    }
    void dispatch()
    domainEventTimer = setInterval(() => void dispatch(), 2_000)
    domainEventTimer.unref()
  }

  let contentCleanupRun: Promise<void> | undefined
  const collectContent = () => {
    if (contentCleanupRun) return contentCleanupRun
    contentCleanupRun = content.collectGarbage()
      .then(() => undefined)
      .catch((error) => {
        console.error(structuredLog('error', 'content.garbage_collection_failed', { error }))
      })
      .finally(() => {
        contentCleanupRun = undefined
      })
    return contentCleanupRun
  }
  void collectContent()
  contentCleanupTimer = setInterval(() => void collectContent(), 15 * 60_000)
  contentCleanupTimer.unref()

  nitroApp.hooks.hook('request', (event) => {
    event.context.services = services
  })
  nitroApp.hooks.hook('close', async () => {
    if (dispatchTimer) clearInterval(dispatchTimer)
    if (domainEventTimer) clearInterval(domainEventTimer)
    if (contentCleanupTimer) clearInterval(contentCleanupTimer)
    await contentCleanupRun
    await rateLimits.close()
    await scoreboardCache.close()
    await scoreboardBuildLock.close()
    await domainEventPublisher.close()
    await publicRealtime.close()
    contentStore.close()
    await database.pool.end()
  })
})
