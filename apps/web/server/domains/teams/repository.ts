export type TeamMemberRole = 'member' | 'captain'
export interface TeamMemberRecord { userId: string, username: string, role: TeamMemberRole, joinedAt: Date }
export interface TeamLockRecord { id: string, title: string, startAt: Date, endAt: Date }
export interface TeamRecord { id: string, name: string, version: number, members: TeamMemberRecord[], locks: TeamLockRecord[] }
export interface CreatedTeam { team: TeamRecord, inviteCode: string }
export type TeamCorrectionOperation = 'add_member' | 'remove_member' | 'transfer_captain'
export interface TeamCorrectionCommand {
  actorId: string
  requestId: string
  teamId: string
  operation: TeamCorrectionOperation
  targetUserId: string
  reason: string
}

export interface TeamRepository {
  findByUser(userId: string): Promise<TeamRecord | null>
  create(name: string, normalizedName: string, captainId: string, inviteDigest: Buffer, inviteCode: string): Promise<CreatedTeam>
  join(userId: string, inviteDigest: Buffer): Promise<TeamRecord>
  leave(userId: string): Promise<void>
  removeMember(actorId: string, memberId: string): Promise<void>
  rotateInvite(actorId: string, inviteDigest: Buffer, inviteCode: string): Promise<string>
  transferCaptain(actorId: string, memberId: string): Promise<void>
  correctMembership(command: TeamCorrectionCommand): Promise<TeamRecord>
}

export class TeamConflictError extends Error {}
export class TeamNotFoundError extends Error {}
export class TeamForbiddenError extends Error {}
export class TeamInviteInvalidError extends Error {}
export class TeamMemberIneligibleError extends Error {}
export class TeamLockedError extends Error {
  constructor(readonly locks: TeamLockRecord[]) { super('Team membership is locked') }
}
