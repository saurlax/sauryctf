import type {
  ChallengeCategory,
  ChallengeFlagPolicy,
  ChallengeInstancePolicy,
  ChallengeScoringPolicy,
} from '../../../shared/contracts/challenges'
import type { ContestPackageManifest } from '../../../shared/contracts/contest-packages'

export interface ContestPackageAssetSnapshot {
  contentObjectId: string
  storageKey: string
  sha256Hex: string
  sizeBytes: number
  mediaType: string
  filename: string
  displayName: string
  sortOrder: number
}

export interface ContestPackageChallengeSnapshot {
  title: string
  category: ChallengeCategory
  description: string
  flagFormat: string | null
  flagPolicy: ChallengeFlagPolicy
  scoringPolicy: ChallengeScoringPolicy
  instancePolicy: ChallengeInstancePolicy
  assets: ContestPackageAssetSnapshot[]
  hints: Array<{
    title: string
    content: string
    releaseAt: Date | null
    sortOrder: number
  }>
  enabled: boolean
  publishAt: Date | null
  closeAt: Date | null
  submissionLimit: number | null
  sortOrder: number
}

export interface ContestPackageSnapshot {
  contestId: string
  title: string
  slug: string
  description: string
  visibility: 'public' | 'private'
  registrationStrategy: 'review' | 'auto_accept'
  inviteRequired: boolean
  startAt: Date
  endAt: Date
  scoreboardFreezeAt: Date | null
  practiceEnabled: boolean
  writeupRequired: boolean
  writeupDeadlineAt: Date | null
  minTeamSize: number
  maxTeamSize: number
  registrationConstraints: { allowedEmailDomains: string[] }
  divisions: Array<{ name: string, sortOrder: number }>
  challenges: ContestPackageChallengeSnapshot[]
}

export interface ContestPackageExportRecord {
  id: string
  contestId: string
  packageObjectId: string
  packageVersion: 'sauryctf.jeopardy.v1'
  createdAt: Date
}

export interface ContestPackageImportRecord {
  id: string
  packageObjectId: string
  packageVersion: 'sauryctf.jeopardy.v1'
  contestId: string
  createdAt: Date
}

export interface ImportedPackageFile {
  path: string
  contentObjectId: string
}

export interface ContestPackageRepository {
  readSnapshot(contestId: string): Promise<ContestPackageSnapshot>
  recordExport(input: {
    actorId: string
    requestId: string
    reason: string
    idempotencyKey: string
    contestId: string
    packageObjectId: string
  }): Promise<ContestPackageExportRecord>
  readExport(exportId: string): Promise<ContestPackageExportRecord>
  importDraft(input: {
    actorId: string
    requestId: string
    reason: string
    idempotencyKey: string
    packageObjectId: string
    inviteDigest: Buffer | null
    manifest: ContestPackageManifest
    files: ImportedPackageFile[]
  }): Promise<ContestPackageImportRecord>
}

export class ContestPackageContestNotFoundError extends Error {}
export class ContestPackageExportNotFoundError extends Error {}
export class ContestPackageIdempotencyConflictError extends Error {}
