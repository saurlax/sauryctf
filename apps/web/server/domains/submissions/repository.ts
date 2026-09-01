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
  flagFormat: string | null
  flagPolicy: ChallengeFlagPolicy
}

export interface SubmissionRepository {
  admit(command: SubmissionAdmissionCommand): Promise<SubmissionAdmission>
}

export class SubmissionTeamRequiredError extends Error {}
export class SubmissionParticipationNotAcceptedError extends Error {}
export class SubmissionContestNotRunningError extends Error {}
export class SubmissionChallengeUnavailableError extends Error {}
export class SubmissionChallengeClosedError extends Error {}
export class SubmissionLimitReachedError extends Error {}
