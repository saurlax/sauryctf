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
