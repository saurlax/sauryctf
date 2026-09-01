import { createHash, randomBytes } from 'node:crypto'
import { identityCapability, requireIdentityCapability } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'
import {
  TeamConflictError,
  TeamForbiddenError,
  TeamInviteInvalidError,
  TeamNotFoundError,
  type CreatedTeam,
  type TeamRecord,
  type TeamRepository,
} from './repository'

export type TeamServiceErrorCode = 'team.conflict' | 'team.forbidden' | 'team.invite_invalid' | 'team.not_found'
export class TeamServiceError extends Error {
  constructor(readonly code: TeamServiceErrorCode) {
    super({
      'team.conflict': '用户已加入队伍或队伍名称已存在',
      'team.forbidden': '当前账号无权执行该队伍操作',
      'team.invite_invalid': '邀请码无效或已撤销',
      'team.not_found': '当前队伍或成员不存在',
    }[code])
  }
}

export class TeamService {
  constructor(private repository: TeamRepository) {}
  async current(actor: SessionSubject) { requireIdentityCapability(actor, identityCapability.teamWrite); return this.repository.findByUser(actor.userId) }
  async create(actor: SessionSubject, name: string): Promise<CreatedTeam> {
    requireIdentityCapability(actor, identityCapability.teamWrite)
    const code = randomBytes(32).toString('base64url')
    return this.map(() => this.repository.create(name.trim(), name.normalize('NFKC').trim().toLocaleLowerCase('en-US'), actor.userId, digest(code), code))
  }
  async join(actor: SessionSubject, code: string): Promise<TeamRecord> { requireIdentityCapability(actor, identityCapability.teamWrite); return this.map(() => this.repository.join(actor.userId, digest(code))) }
  async leave(actor: SessionSubject): Promise<void> { requireIdentityCapability(actor, identityCapability.teamWrite); return this.map(() => this.repository.leave(actor.userId)) }
  async remove(actor: SessionSubject, memberId: string): Promise<void> { requireIdentityCapability(actor, identityCapability.teamWrite); return this.map(() => this.repository.removeMember(actor.userId, memberId)) }
  async rotateInvite(actor: SessionSubject): Promise<string> { requireIdentityCapability(actor, identityCapability.teamWrite); const code = randomBytes(32).toString('base64url'); return this.map(() => this.repository.rotateInvite(actor.userId, digest(code), code)) }
  async transfer(actor: SessionSubject, memberId: string): Promise<void> { requireIdentityCapability(actor, identityCapability.teamWrite); return this.map(() => this.repository.transferCaptain(actor.userId, memberId)) }
  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() }
    catch (error) {
      if (error instanceof TeamConflictError) throw new TeamServiceError('team.conflict')
      if (error instanceof TeamForbiddenError) throw new TeamServiceError('team.forbidden')
      if (error instanceof TeamInviteInvalidError) throw new TeamServiceError('team.invite_invalid')
      if (error instanceof TeamNotFoundError) throw new TeamServiceError('team.not_found')
      throw error
    }
  }
}
function digest(code: string) { return createHash('sha256').update(code).digest() }
