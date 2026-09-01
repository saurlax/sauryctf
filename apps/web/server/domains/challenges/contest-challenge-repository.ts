import type { ChallengeCategory } from '../../../shared/contracts/challenges'

export interface ContestChallengeAssetRecord {
  id: string
  contentObjectId: string
  displayName: string
  sortOrder: number
}

export interface ContestChallengeHintRecord {
  id: string
  title: string
  content: string
  releaseAt: Date | null
  sortOrder: number
}

export interface ContestChallengeRecord {
  id: string
  contestId: string
  sourceTemplateId: string
  sourceVersionId: string
  sourceVersionNumber: number
  snapshotRevision: number
  title: string
  category: ChallengeCategory
  description: string
  flagFormat: string | null
  flagPolicy: Record<string, unknown>
  scoringPolicy: Record<string, unknown>
  instancePolicy: Record<string, unknown>
  assets: ContestChallengeAssetRecord[]
  hints: ContestChallengeHintRecord[]
  enabled: boolean
  publishAt: Date | null
  closeAt: Date | null
  submissionLimit: number | null
  sortOrder: number
  version: number
  createdAt: Date
  updatedAt: Date
}

export interface ContestChallengeAssetCommand {
  contentObjectId: string
  displayName: string
  sortOrder: number
}

export interface ContestChallengeHintCommand {
  title: string
  content: string
  releaseAt: Date | null
  sortOrder: number
}

export interface MountContestChallengeCommand {
  actorId: string
  requestId: string
  challengeId: string
  contestId: string
  templateVersionId: string
  enabled: boolean
  publishAt: Date | null
  closeAt: Date | null
  submissionLimit: number | null
  sortOrder: number
}

export interface ReviseContestChallengeCommand {
  actorId: string
  requestId: string
  contestId: string
  challengeId: string
  expectedVersion: number
  reason: string
  title?: string
  category?: ChallengeCategory
  description?: string
  flagFormat?: string | null
  flagPolicy?: Record<string, unknown>
  scoringPolicy?: Record<string, unknown>
  instancePolicy?: Record<string, unknown>
  assets?: ContestChallengeAssetCommand[]
  hints?: ContestChallengeHintCommand[]
  enabled?: boolean
  publishAt?: Date | null
  closeAt?: Date | null
  submissionLimit?: number | null
  sortOrder?: number
}

export interface ContestChallengeRepository {
  mount(command: MountContestChallengeCommand): Promise<ContestChallengeRecord>
  read(contestId: string, challengeId: string): Promise<ContestChallengeRecord>
  revise(command: ReviseContestChallengeCommand): Promise<ContestChallengeRecord>
}

export class ContestChallengeNotFoundError extends Error {}
export class ContestChallengeTemplateVersionNotFoundError extends Error {}
export class ContestChallengeTitleConflictError extends Error {}
export class ContestChallengeConfigurationLockedError extends Error {}
export class ContestChallengeRevisionNotAllowedError extends Error {}
export class ContestChallengeArchivedError extends Error {}
export class ContestChallengeVersionConflictError extends Error {}
export class ContestChallengeRevisionUnchangedError extends Error {}
