export type ContestPublicationStatus = 'draft' | 'published' | 'archived'
export type ContestTimePhase = 'upcoming' | 'running' | 'ended'

export interface ContestRecord {
  id: string
  title: string
  slug: string
  description: string
  publicationStatus: ContestPublicationStatus
  phase: ContestTimePhase | null
  startAt: Date
  endAt: Date
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
  startAt: Date
  endAt: Date
}

export interface ContestLifecycleCommand {
  actorId: string
  requestId: string
  contestId: string
  reason: string
}

export interface ContestRepository {
  createDraft(command: CreateContestDraftCommand): Promise<ContestRecord>
  readManaged(contestId: string): Promise<ContestRecord>
  readPublic(contestId: string): Promise<ContestRecord>
  publish(command: ContestLifecycleCommand): Promise<ContestRecord>
  archive(command: ContestLifecycleCommand): Promise<ContestRecord>
}

export class ContestNotFoundError extends Error {}
export class ContestSlugConflictError extends Error {}
export class ContestTransitionInvalidError extends Error {}
export class ContestNotEndedError extends Error {}
