export type ContestPublicationStatus = 'draft' | 'published' | 'archived'
export type ContestTimePhase = 'upcoming' | 'running' | 'ended'

export interface ContestRecord {
  id: string
  title: string
  slug: string
  description: string
  publicationStatus: ContestPublicationStatus
  phase: ContestTimePhase | null
  visibility: 'public' | 'private'
  inviteRequired: boolean
  inviteConfigured: boolean
  registrationStrategy: 'review' | 'auto_accept'
  startAt: Date
  endAt: Date
  scoreboardFreezeAt: Date | null
  practiceEnabled: boolean
  writeupRequired: boolean
  writeupDeadlineAt: Date | null
  minTeamSize: number
  maxTeamSize: number
  registrationConstraints: { allowedEmailDomains: string[] }
  publishedAt: Date | null
  archivedAt: Date | null
  version: number
}

export interface CreateContestDraftCommand {
  actorId: string
  requestId: string
  title: string
  slug: string
  description: string
  visibility: 'public' | 'private'
  inviteRequired: boolean
  inviteDigest: Buffer | null
  registrationStrategy: 'review' | 'auto_accept'
  startAt: Date
  endAt: Date
  scoreboardFreezeAt: Date | null
  practiceEnabled: boolean
  writeupRequired: boolean
  writeupDeadlineAt: Date | null
  minTeamSize: number
  maxTeamSize: number
  registrationConstraints: { allowedEmailDomains: string[] }
}

export interface UpdateContestDraftCommand {
  actorId: string
  requestId: string
  contestId: string
  expectedVersion: number
  reason: string
  title: string
  slug: string
  description: string
  visibility: 'public' | 'private'
  inviteRequired: boolean
  replaceInviteDigest: boolean
  inviteDigest: Buffer | null
  registrationStrategy: 'review' | 'auto_accept'
  startAt: Date
  endAt: Date
  scoreboardFreezeAt: Date | null
  practiceEnabled: boolean
  writeupRequired: boolean
  writeupDeadlineAt: Date | null
  minTeamSize: number
  maxTeamSize: number
  registrationConstraints: { allowedEmailDomains: string[] }
}

export interface ContestLifecycleCommand {
  actorId: string
  requestId: string
  contestId: string
  reason: string
}

export type ContestPublicationCheckIssueCode =
  | 'contest.challenge_required'
  | 'challenge.title_missing'
  | 'challenge.description_missing'
  | 'challenge.publication_time_invalid'
  | 'challenge.flag_policy_invalid'
  | 'challenge.scoring_policy_invalid'
  | 'challenge.asset_unavailable'
  | 'challenge.instance_policy_invalid'

export interface ContestPublicationCheckIssue {
  code: ContestPublicationCheckIssueCode
  message: string
  resourceType: 'contest' | 'challenge' | 'asset'
  resourceId: string
  resourceTitle: string | null
  field: string
}

export interface ContestPublicationCheck {
  ready: boolean
  issues: ContestPublicationCheckIssue[]
}

export interface ContestRepository {
  createDraft(command: CreateContestDraftCommand): Promise<ContestRecord>
  updateDraft(command: UpdateContestDraftCommand): Promise<ContestRecord>
  readManaged(contestId: string): Promise<ContestRecord>
  readPublic(contestId: string): Promise<ContestRecord>
  checkPublication(contestId: string): Promise<ContestPublicationCheck>
  publish(command: ContestLifecycleCommand): Promise<ContestRecord>
  archive(command: ContestLifecycleCommand): Promise<ContestRecord>
}

export class ContestNotFoundError extends Error {}
export class ContestSlugConflictError extends Error {}
export class ContestTransitionInvalidError extends Error {}
export class ContestNotEndedError extends Error {}
export class ContestConfigurationLockedError extends Error {}
export class ContestVersionConflictError extends Error {}
export class ContestPublicationCheckFailedError extends Error {
  constructor(readonly check: ContestPublicationCheck) {
    super('Contest publication preflight failed')
  }
}
