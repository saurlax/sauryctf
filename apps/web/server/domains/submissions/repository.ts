import type {
  ChallengeFlagPolicy,
  ChallengeScoringPolicy,
} from '../../../shared/contracts/challenges'

export interface SubmissionAdmissionCommand {
  userId: string
  contestId: string
  challengeId: string
  at: Date
}

export interface SubmissionAdmission {
  contestId: string
  challengeId: string
  participationId: string
  teamId: string
  teamName: string
  flagFormat: string | null
  flagPolicy: ChallengeFlagPolicy
  scoringPolicy: ChallengeScoringPolicy
  mode: SubmissionMode
}

export interface SubmissionRepository {
  admit(command: SubmissionAdmissionCommand): Promise<SubmissionAdmission>
  append(command: AppendSubmissionCommand): Promise<StoredSubmission>
  listManaged(contestId: string, cursor: string | undefined, limit: number): Promise<ManagedSubmissionPage>
  recordScoreAdjustment(command: RecordScoreAdjustmentCommand): Promise<ScoreAdjustmentRecord>
  listCheatClues(
    contestId: string,
    status: CheatClueStatus | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<CheatCluePage>
  reviewCheatClue(command: ReviewCheatClueCommand): Promise<CheatClueRecord>
}

export type VerifiedSubmissionResult = 'correct' | 'incorrect'
export type SubmissionResult = VerifiedSubmissionResult | 'already_solved'
export type SubmissionMode = 'official' | 'practice'

export interface AppendSubmissionCommand extends SubmissionAdmissionCommand {
  requestId: string
  result: VerifiedSubmissionResult
  answerDigest: Buffer
  answerCiphertext: Buffer
}

export interface StoredSubmission {
  id: string
  contestId: string
  challengeId: string
  participationId: string
  userId: string
  mode: SubmissionMode
  result: SubmissionResult
  submittedAt: Date
}

export interface ManagedSubmissionRecord extends StoredSubmission {}

export interface ManagedSubmissionPage {
  items: ManagedSubmissionRecord[]
  nextCursor: string | null
  hasMore: boolean
}

export interface RecordScoreAdjustmentCommand {
  actorId: string
  contestId: string
  participationId: string
  pointsDelta: number
  reason: string
  requestId: string
  at: Date
}

export interface ScoreAdjustmentRecord {
  id: string
  contestId: string
  participationId: string
  pointsDelta: number
  reason: string
  createdBy: string
  requestId: string
  createdAt: Date
}

export type CheatClueStatus = 'open' | 'reviewing' | 'dismissed' | 'confirmed'
export type CheatClueType =
  | 'repeated_incorrect_answer'
  | 'shared_incorrect_answer'
  | 'abnormal_submission_frequency'
  | 'foreign_team_flag'

export interface CheatClueRecord {
  id: string
  contestId: string
  challengeId: string | null
  participationId: string | null
  clueType: CheatClueType
  evidence: Record<string, unknown>
  status: CheatClueStatus
  reviewedBy: string | null
  reviewNote: string | null
  reviewedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface CheatCluePage {
  items: CheatClueRecord[]
  nextCursor: string | null
  hasMore: boolean
}

export interface ReviewCheatClueCommand {
  actorId: string
  contestId: string
  clueId: string
  status: Exclude<CheatClueStatus, 'open'>
  note: string | null
  requestId: string
  at: Date
}

export class SubmissionTeamRequiredError extends Error {}
export class SubmissionParticipationNotAcceptedError extends Error {}
export class SubmissionContestNotRunningError extends Error {}
export class SubmissionChallengeUnavailableError extends Error {}
export class SubmissionChallengeClosedError extends Error {}
export class SubmissionLimitReachedError extends Error {}
export class SubmissionRequestConflictError extends Error {}
export class SubmissionCursorInvalidError extends Error {}
export class SubmissionContestNotFoundError extends Error {}
export class SubmissionParticipationNotFoundError extends Error {}
export class ScoreAdjustmentArchivedContestError extends Error {}
export class ScoreAdjustmentRequestConflictError extends Error {}
export class CheatClueNotFoundError extends Error {}
export class CheatClueCursorInvalidError extends Error {}
export class CheatClueReviewConflictError extends Error {}
export class CheatClueRequestConflictError extends Error {}
