import type { ChallengeFlagPolicy } from '../../../shared/contracts/challenges'

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
}

export interface SubmissionRepository {
  admit(command: SubmissionAdmissionCommand): Promise<SubmissionAdmission>
  append(command: AppendSubmissionCommand): Promise<StoredSubmission>
  listManaged(contestId: string, cursor: string | undefined, limit: number): Promise<ManagedSubmissionPage>
}

export type VerifiedSubmissionResult = 'correct' | 'incorrect'
export type SubmissionResult = VerifiedSubmissionResult | 'already_solved'

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
  mode: 'official'
  result: SubmissionResult
  submittedAt: Date
}

export interface ManagedSubmissionRecord extends StoredSubmission {}

export interface ManagedSubmissionPage {
  items: ManagedSubmissionRecord[]
  nextCursor: string | null
  hasMore: boolean
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
