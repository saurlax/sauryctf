import type { ChallengeCategory } from '../../../shared/contracts/challenges'

export interface ChallengeTemplateAssetRecord {
  id: string
  contentObjectId: string
  displayName: string
  sortOrder: number
}

export interface ChallengeTemplateHintRecord {
  id: string
  title: string
  content: string
  releaseAfterSeconds: number | null
  sortOrder: number
}

export interface ChallengeTemplateVersionRecord {
  id: string
  templateId: string
  versionNumber: number
  title: string
  category: ChallengeCategory
  description: string
  flagFormat: string | null
  flagPolicy: Record<string, unknown>
  scoringPolicy: Record<string, unknown>
  instancePolicy: Record<string, unknown>
  assets: ChallengeTemplateAssetRecord[]
  hints: ChallengeTemplateHintRecord[]
  createdBy: string
  createdAt: Date
}

export interface ChallengeTemplateRecord {
  id: string
  name: string
  slug: string
  latestVersion: number
  version: number
  createdAt: Date
  updatedAt: Date
}

export interface ChallengeTemplateDetail {
  template: ChallengeTemplateRecord
  challengeVersion: ChallengeTemplateVersionRecord
}

export interface ChallengeTemplateAssetCommand {
  contentObjectId: string
  displayName: string
  sortOrder: number
}

export interface ChallengeTemplateHintCommand {
  title: string
  content: string
  releaseAfterSeconds: number | null
  sortOrder: number
}

export interface ChallengeVersionSnapshotCommand {
  title: string
  category: ChallengeCategory
  description: string
  flagFormat: string | null
  flagPolicy: Record<string, unknown>
  scoringPolicy: Record<string, unknown>
  instancePolicy: Record<string, unknown>
  assets: ChallengeTemplateAssetCommand[]
  hints: ChallengeTemplateHintCommand[]
}

export interface CreateChallengeTemplateCommand extends ChallengeVersionSnapshotCommand {
  actorId: string
  requestId: string
  templateId: string
  versionId: string
  name: string
  slug: string
}

export interface CreateChallengeTemplateVersionCommand extends ChallengeVersionSnapshotCommand {
  actorId: string
  requestId: string
  templateId: string
  versionId: string
  expectedVersion: number
  reason: string
}

export interface ChallengeTemplateRepository {
  create(command: CreateChallengeTemplateCommand): Promise<ChallengeTemplateDetail>
  createVersion(command: CreateChallengeTemplateVersionCommand): Promise<ChallengeTemplateDetail>
  read(templateId: string, versionNumber?: number): Promise<ChallengeTemplateDetail>
}

export class ChallengeTemplateNotFoundError extends Error {}
export class ChallengeTemplateSlugConflictError extends Error {}
export class ChallengeTemplateVersionConflictError extends Error {}
export class ChallengeContentObjectUnavailableError extends Error {
  constructor(readonly contentObjectIds: string[]) {
    super('Challenge attachment content is not committed')
  }
}
