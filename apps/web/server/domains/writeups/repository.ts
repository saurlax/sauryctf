export type WriteupStatus = 'draft' | 'submitted' | 'approved' | 'changes_requested'
export type WriteupReviewDecision = 'approved' | 'changes_requested'

export interface WriteupAttachmentRecord {
  referenceId: string
  contentObjectId: string
  filename: string
  mediaType: string
  sizeBytes: number
  sha256Hex: string
}

export interface WriteupVersionRecord {
  id: string
  versionNumber: number
  body: string
  createdBy: string
  createdAt: Date
  attachments: WriteupAttachmentRecord[]
}

export interface WriteupRecord {
  id: string
  contestId: string
  participationId: string
  teamId: string
  teamName: string
  status: WriteupStatus
  currentVersion: number
  submittedVersion: number | null
  submittedAt: Date | null
  reviewedBy: string | null
  reviewNote: string | null
  reviewedAt: Date | null
  version: number
  updatedAt: Date
  current: WriteupVersionRecord
  submitted: WriteupVersionRecord | null
}

export interface OwnWriteupState {
  contestId: string
  writeupRequired: boolean
  writeupDeadlineAt: Date | null
  writeup: WriteupRecord | null
}

export interface ManagedWriteupPage {
  items: WriteupRecord[]
  nextCursor: string | null
  hasMore: boolean
}

export interface SaveOwnWriteupCommand {
  actorId: string
  contestId: string
  expectedVersion: number
  body: string
  attachmentIds: string[]
}

export interface SubmitOwnWriteupCommand {
  actorId: string
  contestId: string
  expectedVersion: number
}

export interface ReviewWriteupCommand {
  actorId: string
  requestId: string
  contestId: string
  writeupId: string
  expectedVersion: number
  decision: WriteupReviewDecision
  note: string | null
}

export interface CorrectWriteupCommand {
  actorId: string
  requestId: string
  contestId: string
  writeupId: string
  expectedVersion: number
  body: string
  attachmentIds: string[]
  reason: string
}

export interface WriteupExportAttachment {
  referenceId: string
  contentObjectId: string
  storageKey: string
  filename: string
  mediaType: string
  sizeBytes: number
  sha256Hex: string
}

export interface WriteupExportEntry {
  writeupId: string
  participationId: string
  teamId: string
  teamName: string
  versionNumber: number
  body: string
  submittedAt: Date
  attachments: WriteupExportAttachment[]
}

export interface WriteupExportSnapshot {
  contestId: string
  contestTitle: string
  entries: WriteupExportEntry[]
}

export interface WriteupRepository {
  readOwn(actorId: string, contestId: string): Promise<OwnWriteupState>
  saveOwn(command: SaveOwnWriteupCommand): Promise<WriteupRecord>
  submitOwn(command: SubmitOwnWriteupCommand): Promise<WriteupRecord>
  listManaged(
    contestId: string,
    status: WriteupStatus | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<ManagedWriteupPage>
  review(command: ReviewWriteupCommand): Promise<WriteupRecord>
  correct(command: CorrectWriteupCommand): Promise<WriteupRecord>
  exportSubmitted(contestId: string): Promise<WriteupExportSnapshot>
}

export class WriteupNotFoundError extends Error {}
export class WriteupContestArchivedError extends Error {}
export class WriteupNotRequiredError extends Error {}
export class WriteupDeadlinePassedError extends Error {}
export class WriteupVersionConflictError extends Error {}
export class WriteupCurrentVersionMissingError extends Error {}
export class WriteupNotSubmittedError extends Error {}
export class WriteupNoChangesToSubmitError extends Error {}
export class WriteupAttachmentUnavailableError extends Error {
  constructor(readonly contentObjectIds: string[]) {
    super('One or more Writeup attachments are unavailable')
  }
}
