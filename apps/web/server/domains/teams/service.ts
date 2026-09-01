import { createHash, randomBytes } from 'node:crypto'
import { identityCapability, requireIdentityCapability } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'
import {
  TeamConflictError,
  TeamForbiddenError,
  TeamInviteInvalidError,
  TeamLockedError,
  TeamMemberIneligibleError,
  TeamNotFoundError,
  type CreatedTeam,
  type TeamRecord,
  type TeamRepository,
} from './repository'

export type TeamServiceErrorCode =
  | 'team.conflict'
  | 'team.forbidden'
  | 'team.invite_invalid'
  | 'team.locked'
  | 'team.member_ineligible'
  | 'team.not_found'
  | 'team.reason_required'
export class TeamServiceError extends Error {
  constructor(readonly code: TeamServiceErrorCode, readonly locks = [] as TeamRecord['locks']) {
    const messages = {
      'team.conflict': '用户已加入队伍或队伍名称已存在',
      'team.forbidden': '当前账号无权执行该队伍操作',
      'team.invite_invalid': '邀请码无效或已撤销',
      'team.locked': lockMessage(locks),
      'team.member_ineligible': '目标用户不满足队伍成员条件',
      'team.not_found': '当前队伍或成员不存在',
      'team.reason_required': '管理员纠正必须填写至少 10 个字符的原因',
    }
    super(messages[code])
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
  async correctMembership(actor: SessionSubject, input: {
    requestId: string
    teamId: string
    operation: 'add_member' | 'remove_member' | 'transfer_captain'
    targetUserId: string
    reason: string
  }): Promise<TeamRecord> {
    requireIdentityCapability(actor, identityCapability.globalOperationsManage)
    const reason = input.reason.trim()
    if (reason.length < 10 || reason.length > 1000) throw new TeamServiceError('team.reason_required')
    return this.map(() => this.repository.correctMembership({
      actorId: actor.userId,
      requestId: input.requestId,
      teamId: input.teamId,
      operation: input.operation,
      targetUserId: input.targetUserId,
      reason,
    }))
  }
  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() }
    catch (error) {
      if (error instanceof TeamConflictError) throw new TeamServiceError('team.conflict')
      if (error instanceof TeamForbiddenError) throw new TeamServiceError('team.forbidden')
      if (error instanceof TeamInviteInvalidError) throw new TeamServiceError('team.invite_invalid')
      if (error instanceof TeamLockedError) throw new TeamServiceError('team.locked', error.locks)
      if (error instanceof TeamMemberIneligibleError) throw new TeamServiceError('team.member_ineligible')
      if (error instanceof TeamNotFoundError) throw new TeamServiceError('team.not_found')
      throw error
    }
  }
}
function digest(code: string) { return createHash('sha256').update(code).digest() }

function lockMessage(locks: TeamRecord['locks']): string {
  if (!locks.length) return '队伍已被未结束比赛锁定'
  const summary = locks.slice(0, 3).map(lock => `${lock.title}（${lock.endAt.toISOString()} 结束）`).join('、')
  return `队伍已被未结束比赛锁定：${summary}${locks.length > 3 ? `等 ${locks.length} 场比赛` : ''}`
}
