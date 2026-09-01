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

export interface ContestRepository {
  createDraft(command: CreateContestDraftCommand): Promise<ContestRecord>
  updateDraft(command: UpdateContestDraftCommand): Promise<ContestRecord>
  readManaged(contestId: string): Promise<ContestRecord>
  readPublic(contestId: string): Promise<ContestRecord>
  publish(command: ContestLifecycleCommand): Promise<ContestRecord>
  archive(command: ContestLifecycleCommand): Promise<ContestRecord>
}

export class ContestNotFoundError extends Error {}
export class ContestSlugConflictError extends Error {}
export class ContestTransitionInvalidError extends Error {}
export class ContestNotEndedError extends Error {}
export class ContestConfigurationLockedError extends Error {}
export class ContestVersionConflictError extends Error {}
