export type TeamMemberRole = 'member' | 'captain'
export interface TeamMemberRecord { userId: string, username: string, role: TeamMemberRole, joinedAt: Date }
export interface TeamRecord { id: string, name: string, version: number, members: TeamMemberRecord[] }
export interface CreatedTeam { team: TeamRecord, inviteCode: string }

export interface TeamRepository {
  findByUser(userId: string): Promise<TeamRecord | null>
  create(name: string, normalizedName: string, captainId: string, inviteDigest: Buffer, inviteCode: string): Promise<CreatedTeam>
  join(userId: string, inviteDigest: Buffer): Promise<TeamRecord>
  leave(userId: string): Promise<void>
  removeMember(actorId: string, memberId: string): Promise<void>
  rotateInvite(actorId: string, inviteDigest: Buffer, inviteCode: string): Promise<string>
  transferCaptain(actorId: string, memberId: string): Promise<void>
}

export class TeamConflictError extends Error {}
export class TeamNotFoundError extends Error {}
export class TeamForbiddenError extends Error {}
export class TeamInviteInvalidError extends Error {}
