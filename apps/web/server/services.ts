import type { IdentityService } from './domains/identity/service'
import type { IdentitySessionService } from './domains/identity/session'
import type { HumanVerificationProvider } from './domains/identity/human-verification'
import type { RateLimitStore } from './infrastructure/security/rate-limit'
import type { TeamService } from './domains/teams/service'
import type { ParticipationService } from './domains/participations/service'
import type { ContestService } from './domains/contests/service'
import type { AnnouncementService } from './domains/announcements/service'
import type { PublicTimelineService } from './domains/timeline/service'
import type { ChallengeTemplateService } from './domains/challenges/service'
import type { ContestChallengeService } from './domains/challenges/contest-challenge-service'
import type { SubmissionService } from './domains/submissions/service'
import type { ScoreboardViewService } from './domains/scoreboards/view-service'
import type { PublicRealtimeLog } from './domains/events/public-realtime'
import type { ContentObjectService } from './domains/content/service'
import type { ContentDownloadService } from './domains/content/download-service'
import type { WriteupService } from './domains/writeups/service'
import type { ContestPackageService } from './domains/contest-packages/service'
import type { PlatformSettingsService } from './domains/platform-settings/service'

export interface ControlPlaneServices {
  identity: IdentityService
  identitySessions: IdentitySessionService
  humanVerification: HumanVerificationProvider
  rateLimits: RateLimitStore
  teams: TeamService
  participations: ParticipationService
  contests: ContestService
  announcements: AnnouncementService
  timeline: PublicTimelineService
  challengeTemplates: ChallengeTemplateService
  contestChallenges: ContestChallengeService
  submissions: SubmissionService
  scoreboards: ScoreboardViewService
  publicRealtime: PublicRealtimeLog
  content: ContentObjectService
  contentDownloads: ContentDownloadService
  writeups: WriteupService
  contestPackages: ContestPackageService
  platformSettings: PlatformSettingsService
}
