export type ParticipationStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn'

export interface ParticipationRecord {
  id: string
  contestId: string
  teamId: string
  teamName: string
  divisionId: string | null
  divisionName: string | null
  status: ParticipationStatus
  registeredAt: Date
  reviewedAt: Date | null
  reviewReason: string | null
  withdrawnAt: Date | null
  version: number
}

export interface CurrentParticipationRecord {
  team: { id: string, name: string, role: 'member' | 'captain' } | null
  participation: ParticipationRecord | null
}

export interface ParticipationReviewCommand {
  actorId: string
  requestId: string
  contestId: string
  participationId: string
  decision: 'accepted' | 'rejected'
  reason: string
}

export interface ParticipationDivisionCommand {
  actorId: string
  requestId: string
  contestId: string
  participationId: string
  divisionId: string | null
  reason: string | null
}

export interface ParticipationPage {
  items: ParticipationRecord[]
  nextCursor: string | null
  hasMore: boolean
}

export interface ParticipationRepository {
  current(userId: string, contestId: string): Promise<CurrentParticipationRecord>
  register(userId: string, contestId: string, inviteDigest: Buffer | null): Promise<ParticipationRecord>
  withdraw(userId: string, contestId: string): Promise<ParticipationRecord>
  review(command: ParticipationReviewCommand): Promise<ParticipationRecord>
  assignDivision(command: ParticipationDivisionCommand): Promise<ParticipationRecord>
  list(contestId: string, cursor: string | undefined, limit: number, status: ParticipationStatus | undefined): Promise<ParticipationPage>
}

export class ParticipationConflictError extends Error {}
export class ParticipationContestNotFoundError extends Error {}
export class ParticipationRegistrationClosedError extends Error {}
export class ParticipationTeamRequiredError extends Error {}
export class ParticipationInviteInvalidError extends Error {}
export class ParticipationTeamSizeError extends Error {
  constructor(readonly minimum: number, readonly maximum: number, readonly actual: number) {
    super('Team size is outside contest bounds')
  }
}
export class ParticipationMemberIneligibleError extends Error {}
export class ParticipationEmailDomainForbiddenError extends Error {}
export class ParticipationConfigurationInvalidError extends Error {}
export class ParticipationNotFoundError extends Error {}
export class ParticipationTransitionInvalidError extends Error {}
export class ParticipationDivisionInvalidError extends Error {}
