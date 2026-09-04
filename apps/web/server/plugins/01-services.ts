import { randomUUID } from 'node:crypto'
import { db } from 'hub:db'
import { IdentityService } from '../domains/identity/service'
import { IdentitySessionService } from '../domains/identity/session'
import { MailOutboxDispatcher } from '../domains/notifications/mail-outbox'
import { DisabledHumanVerificationProvider } from '../domains/identity/human-verification'
import { identityTokenCodec } from '../infrastructure/auth/identity-token-codec'
import { AesGcmIdentityMailTokenProtector } from '../infrastructure/auth/identity-mail-token-protector'
import { nuxtPasswordHasher } from '../infrastructure/auth/nuxt-password-hasher'
import { TurnstileHumanVerificationProvider } from '../infrastructure/auth/turnstile'
import { createDatabaseExecutor } from '../infrastructure/db/executor'
import { PostgresIdentityRepository } from '../infrastructure/db/identity-repository'
import { PostgresMailOutboxRepository } from '../infrastructure/mail/postgres-mail-outbox'
import { SmtpMailTransport } from '../infrastructure/mail/smtp-mail-transport'
import { PostgresRateLimitStore } from '../infrastructure/security/postgres-rate-limit-store'
import { structuredLog } from '../infrastructure/telemetry/logging'
import { activeControlPlaneTelemetry } from '../infrastructure/telemetry/telemetry'
import { AdministrationMonitoringService } from '../domains/administration/monitoring'
import { AdministrationOperationsService } from '../domains/administration/operations'
import { PostgresMonitoringRepository } from '../infrastructure/db/monitoring-repository'
import { PostgresOperationalCommandRepository } from '../infrastructure/db/operations-repository'
import { DataRetentionService } from '../jobs/data-retention'
import {
  PostgresDataRetentionRepository,
  PostgresSecurityLogWriter,
} from '../infrastructure/db/data-retention-repository'
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
import { PostgresScoringReplayRepository } from '../infrastructure/db/scoring-replay-repository'
import { PostgresScoreboardViewRepository } from '../infrastructure/db/scoreboard-view-repository'
import { ContentObjectService } from '../domains/content/service'
import { ContentDownloadService } from '../domains/content/download-service'
import { PostgresContentObjectRepository } from '../infrastructure/db/content-object-repository'
import { PostgresContentDownloadRepository } from '../infrastructure/db/content-download-repository'
import { parseDataServicesConfig } from '../infrastructure/config/data-services'
import { getControlPlaneBlobStorage } from '../infrastructure/storage/blob-storage'
import { NuxtHubContentObjectStore } from '../infrastructure/storage/nuxthub-content-object-store'
import { ControlPlaneDataServicesReadiness, NuxtHubBlobReadiness } from '../infrastructure/storage/readiness'
import { WriteupService } from '../domains/writeups/service'
import { PostgresWriteupRepository } from '../infrastructure/db/writeup-repository'
import { ZipWriteupArchiveBuilder } from '../infrastructure/content/writeup-zip'
import { ContestPackageService } from '../domains/contest-packages/service'
import { PostgresContestPackageRepository } from '../infrastructure/db/contest-package-repository'
import { ContestPackageArchiveCodec } from '../infrastructure/content/contest-package-archive'
import { PlatformSettingsService } from '../domains/platform-settings/service'
import { PostgresPlatformSettingsRepository } from '../infrastructure/db/platform-settings-repository'
import { InstanceService } from '../domains/instances/service'
import { PostgresInstanceRepository } from '../infrastructure/db/instance-repository'
import { PostgresControlPlaneReadiness } from '../infrastructure/db/readiness'

export default defineNitroPlugin(async (nitroApp) => {
  const databaseUrl = process.env.DATABASE_URL
  const sessionPassword = process.env.NUXT_SESSION_PASSWORD
  const submissionAnswerKey = process.env.SUBMISSION_ANSWER_KEY
  if (!databaseUrl || !sessionPassword || !submissionAnswerKey) return

  const dataServices = parseDataServicesConfig(process.env)
  const database = createDatabaseExecutor(db)
  const identityRepository = new PostgresIdentityRepository(database)
  const rateLimits = new PostgresRateLimitStore(database)
  const contentStore = new NuxtHubContentObjectStore(
    await getControlPlaneBlobStorage(dataServices.blob),
  )
  const content = new ContentObjectService(
    new PostgresContentObjectRepository(database),
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
    new PostgresScoringReplayRepository(database),
  )
  const platformSettings = new PlatformSettingsService(
    new PostgresPlatformSettingsRepository(database),
    content,
  )
  const scoreboards = new ScoreboardViewService(
    new PostgresScoreboardViewRepository(database),
    scoringReplays,
    undefined,
    undefined,
    new ScoreboardBuildCoordinator(),
  )
  const operationalCommands = new PostgresOperationalCommandRepository(database)
  const dataRetention = new DataRetentionService(new PostgresDataRetentionRepository(database))
  const dataServicesReadiness = new ControlPlaneDataServicesReadiness(
    new PostgresControlPlaneReadiness(database),
    new NuxtHubBlobReadiness(dataServices.blob, contentStore),
    dataServices.blob.driver,
  )
  const services: ControlPlaneServices = {
    readiness: dataServicesReadiness,
    identity,
    identitySessions: new IdentitySessionService(identityRepository),
    humanVerification,
    rateLimits,
    teams: new TeamService(new PostgresTeamRepository(database)),
    participations: new ParticipationService(new PostgresParticipationRepository(database)),
    contests: new ContestService(new PostgresContestRepository(database)),
    announcements: new AnnouncementService(new PostgresAnnouncementRepository(database)),
    timeline: new PublicTimelineService(new PostgresPublicTimelineRepository(database)),
    challengeTemplates: new ChallengeTemplateService(new PostgresChallengeTemplateRepository(database)),
    contestChallenges: new ContestChallengeService(new PostgresContestChallengeRepository(database)),
    submissions: new SubmissionService(
      new PostgresSubmissionRepository(database),
      new FlagVerifier(new VersionedFlagKeyring({})),
      new RateLimitStoreSubmissionLimiter(rateLimits),
      new AesGcmSubmissionAnswerProtector(Buffer.from(submissionAnswerKey, 'base64url')),
    ),
    scoreboards,
    content,
    contentDownloads: new ContentDownloadService(
      new PostgresContentDownloadRepository(database),
      contentStore,
    ),
    writeups: new WriteupService(
      new PostgresWriteupRepository(database),
      new ZipWriteupArchiveBuilder(contentStore),
    ),
    contestPackages: new ContestPackageService(
      new PostgresContestPackageRepository(database),
      content,
      new ContestPackageArchiveCodec(contentStore),
    ),
    platformSettings,
    instances: new InstanceService(
      new PostgresInstanceRepository(database, activeControlPlaneTelemetry()),
      instanceLeasePolicy(process.env),
    ),
    monitoring: new AdministrationMonitoringService(
      new PostgresMonitoringRepository(database),
      positiveSeconds(process.env.WORKER_OBSERVATION_STALE_SECONDS, 90) * 1000,
      undefined,
      dataServicesReadiness,
    ),
    operations: new AdministrationOperationsService(
      operationalCommands,
      scoreboards,
    ),
    securityLogs: new PostgresSecurityLogWriter(database),
  }

  const smtpHost = process.env.MAIL_SMTP_HOST
  const mailFrom = process.env.MAIL_FROM
  const siteUrl = useRuntimeConfig().public.siteUrl
  let dispatchTimer: ReturnType<typeof setInterval> | undefined
  let contentCleanupTimer: ReturnType<typeof setInterval> | undefined
  let retentionTimer: ReturnType<typeof setInterval> | undefined
  let telemetryTimer: ReturnType<typeof setInterval> | undefined
  if (smtpHost && mailFrom) {
    const smtpPort = Number.parseInt(process.env.MAIL_SMTP_PORT ?? '25', 10)
    const dispatcher = new MailOutboxDispatcher(
      `control-plane-${randomUUID()}`,
      new PostgresMailOutboxRepository(database),
      new SmtpMailTransport({
        host: smtpHost,
        port: Number.isSafeInteger(smtpPort) && smtpPort > 0 ? smtpPort : 25,
        secure: process.env.MAIL_SMTP_SECURE === 'true',
        username: process.env.MAIL_SMTP_USERNAME,
        password: process.env.MAIL_SMTP_PASSWORD,
        from: mailFrom,
        siteUrl,
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
        const processed = await dispatcher.runOnce()
        activeControlPlaneTelemetry()?.recordMailDispatch('processed', processed)
      }
      catch (error) {
        activeControlPlaneTelemetry()?.recordMailDispatch('failed')
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

  let retentionRun: Promise<void> | undefined
  const applyRetention = () => {
    if (retentionRun) return retentionRun
    retentionRun = dataRetention.run()
      .then(result => {
        if (result.auditDeleted > 0
          || result.securityLogsDeleted > 0
          || result.rateLimitWindowsDeleted > 0) {
          console.info(structuredLog('info', 'retention.completed', {
            audit_deleted: result.auditDeleted,
            security_logs_deleted: result.securityLogsDeleted,
            rate_limit_windows_deleted: result.rateLimitWindowsDeleted,
            batches: result.batches,
          }))
        }
      })
      .catch((error) => {
        console.error(structuredLog('error', 'retention.failed', { error }))
      })
      .finally(() => {
        retentionRun = undefined
      })
    return retentionRun
  }
  void applyRetention()
  retentionTimer = setInterval(() => void applyRetention(), 6 * 60 * 60_000)
  retentionTimer.unref()

  let telemetryRefresh: Promise<void> | undefined
  const refreshOperationalMetrics = () => {
    const telemetry = activeControlPlaneTelemetry()
    if (!telemetry || telemetryRefresh) return telemetryRefresh
    telemetryRefresh = Promise.all([
      groupedCounts(database, 'mail_deliveries', 'status'),
      groupedCounts(database, 'instance_jobs', 'status'),
      groupedCounts(database, 'instances', 'observed_state'),
    ])
      .then(([mailDeliveries, instanceJobs, instances]) => {
        telemetry.updateOperationalSnapshot({ mailDeliveries, instanceJobs, instances })
      })
      .catch((error) => {
        telemetry.emit('warn', 'telemetry.snapshot_failed', { error_type: errorName(error) })
      })
      .finally(() => {
        telemetryRefresh = undefined
      })
    return telemetryRefresh
  }
  void refreshOperationalMetrics()
  telemetryTimer = setInterval(() => void refreshOperationalMetrics(), 15_000)
  telemetryTimer.unref()

  nitroApp.hooks.hook('request', (event) => {
    event.context.services = services
  })
  nitroApp.hooks.hook('close', async () => {
    if (dispatchTimer) clearInterval(dispatchTimer)
    if (contentCleanupTimer) clearInterval(contentCleanupTimer)
    if (retentionTimer) clearInterval(retentionTimer)
    if (telemetryTimer) clearInterval(telemetryTimer)
    await contentCleanupRun
    await retentionRun
    await telemetryRefresh
    contentStore.close()
    await db.$client.end()
  })
})

async function groupedCounts(
  database: Pick<ReturnType<typeof createDatabaseExecutor>, 'query'>,
  table: 'mail_deliveries' | 'instance_jobs' | 'instances',
  column: 'status' | 'observed_state',
) {
  const result = await database.query<{ label: string, count: string }>(
    `SELECT ${column}::text AS label, count(*)::text AS count FROM ${table} GROUP BY ${column}`,
  )
  return Object.fromEntries(result.rows.map(row => [row.label, Number(row.count)]))
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : 'UnknownError'
}

function instanceLeasePolicy(environment: NodeJS.ProcessEnv) {
  return {
    initialDurationMs: positiveMinutes(environment.INSTANCE_LEASE_DURATION_MINUTES, 60) * 60_000,
    extensionDurationMs: positiveMinutes(environment.INSTANCE_EXTENSION_DURATION_MINUTES, 30) * 60_000,
    renewalWindowMs: positiveMinutes(environment.INSTANCE_RENEWAL_WINDOW_MINUTES, 10) * 60_000,
    teamActiveLimit: positiveInteger(environment.INSTANCE_TEAM_ACTIVE_LIMIT, 1),
  }
}

function positiveSeconds(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function positiveMinutes(value: string | undefined, fallback: number) {
  return positiveInteger(value, fallback)
}

function positiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError('实例租约配置必须是正整数')
  }
  return parsed
}
