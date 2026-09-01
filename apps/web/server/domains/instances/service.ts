import type { InstanceLeasePolicy as PublicInstanceLeasePolicy, PlayerInstance } from '../../../shared/contracts/instances'
import { identityCapability, requireIdentityCapability } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'
import {
  InstanceChallengeNotAvailableError,
  InstanceConfigurationInvalidError,
  InstanceContestNotAvailableError,
  InstanceNotRunningError,
  InstanceParticipationNotAcceptedError,
  InstanceQuotaExceededError,
  InstanceRenewalTooEarlyError,
  InstanceTeamRequiredError,
  InstanceUnavailableError,
  type InstanceLeasePolicy,
  type InstanceRecord,
  type InstanceRepository,
} from './repository'

export type InstanceServiceErrorCode =
  | 'instance.not_available'
  | 'team.membership_required'
  | 'participation.not_accepted'
  | 'contest.instance_unavailable'
  | 'challenge.instance_unavailable'
  | 'instance.configuration_invalid'
  | 'instance.quota_exceeded'
  | 'instance.not_running'
  | 'instance.renewal_too_early'

export class InstanceServiceError extends Error {
  constructor(
    readonly code: InstanceServiceErrorCode,
    readonly fields: Record<string, string[]> = {},
  ) {
    super({
      'instance.not_available': '实例不存在或当前账号无权访问',
      'team.membership_required': '需要先加入队伍',
      'participation.not_accepted': '当前队伍尚未获得比赛资格',
      'contest.instance_unavailable': '当前比赛阶段不允许操作实例',
      'challenge.instance_unavailable': '题目实例尚未开放',
      'instance.configuration_invalid': '题目实例配置不可用',
      'instance.quota_exceeded': '队伍活动实例数量已达到上限',
      'instance.not_running': '当前没有可续期的运行实例',
      'instance.renewal_too_early': '实例尚未进入续期窗口',
    }[code])
    this.name = 'InstanceServiceError'
  }
}

export interface PlayerInstanceResult {
  instance: PlayerInstance | null
  policy: PublicInstanceLeasePolicy
}

export class InstanceService {
  constructor(
    private readonly repository: InstanceRepository,
    private readonly policy: InstanceLeasePolicy,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!Number.isSafeInteger(policy.initialDurationMs) || policy.initialDurationMs <= 0
      || !Number.isSafeInteger(policy.extensionDurationMs) || policy.extensionDurationMs <= 0
      || !Number.isSafeInteger(policy.renewalWindowMs) || policy.renewalWindowMs <= 0
      || policy.renewalWindowMs > policy.initialDurationMs
      || !Number.isSafeInteger(policy.teamActiveLimit) || policy.teamActiveLimit <= 0) {
      throw new TypeError('实例租约策略无效')
    }
  }

  async read(actor: SessionSubject, contestId: string, challengeId: string): Promise<PlayerInstanceResult> {
    requireIdentityCapability(actor, identityCapability.instanceOperate)
    const at = this.now()
    const instance = await this.map(() => this.repository.read({
      actorId: actor.userId,
      contestId,
      challengeId,
      at,
      policy: this.policy,
    }))
    return { instance: instance ? this.project(instance, at) : null, policy: this.publicPolicy() }
  }

  async start(actor: SessionSubject, input: { requestId: string, contestId: string, challengeId: string }): Promise<PlayerInstanceResult> {
    requireIdentityCapability(actor, identityCapability.instanceOperate)
    const at = this.now()
    const instance = await this.map(() => this.repository.start({
      actorId: actor.userId,
      requestId: input.requestId,
      contestId: input.contestId,
      challengeId: input.challengeId,
      at,
      policy: this.policy,
    }))
    return { instance: this.project(instance, at), policy: this.publicPolicy() }
  }

  async renew(actor: SessionSubject, input: { requestId: string, contestId: string, challengeId: string }): Promise<PlayerInstanceResult> {
    requireIdentityCapability(actor, identityCapability.instanceOperate)
    const at = this.now()
    const instance = await this.map(() => this.repository.renew({
      actorId: actor.userId,
      requestId: input.requestId,
      contestId: input.contestId,
      challengeId: input.challengeId,
      at,
      policy: this.policy,
    }))
    return { instance: this.project(instance, at), policy: this.publicPolicy() }
  }

  async destroy(actor: SessionSubject, input: { requestId: string, contestId: string, challengeId: string }): Promise<PlayerInstanceResult> {
    requireIdentityCapability(actor, identityCapability.instanceOperate)
    const at = this.now()
    const instance = await this.map(() => this.repository.destroy({
      actorId: actor.userId,
      requestId: input.requestId,
      contestId: input.contestId,
      challengeId: input.challengeId,
      at,
      policy: this.policy,
    }))
    return { instance: this.project(instance, at), policy: this.publicPolicy() }
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    }
    catch (error) {
      if (error instanceof InstanceUnavailableError) throw new InstanceServiceError('instance.not_available')
      if (error instanceof InstanceTeamRequiredError) throw new InstanceServiceError('team.membership_required')
      if (error instanceof InstanceParticipationNotAcceptedError) throw new InstanceServiceError('participation.not_accepted')
      if (error instanceof InstanceContestNotAvailableError) throw new InstanceServiceError('contest.instance_unavailable')
      if (error instanceof InstanceChallengeNotAvailableError) throw new InstanceServiceError('challenge.instance_unavailable')
      if (error instanceof InstanceConfigurationInvalidError) throw new InstanceServiceError('instance.configuration_invalid')
      if (error instanceof InstanceQuotaExceededError) throw new InstanceServiceError('instance.quota_exceeded')
      if (error instanceof InstanceNotRunningError) throw new InstanceServiceError('instance.not_running')
      if (error instanceof InstanceRenewalTooEarlyError) {
        throw new InstanceServiceError('instance.renewal_too_early', {
          renewable_at: [error.renewableAt.toISOString()],
        })
      }
      throw error
    }
  }

  private project(instance: InstanceRecord, at: Date): PlayerInstance {
    const currentGeneration = instance.observedGeneration === instance.desiredGeneration
    const expired = instance.desiredState === 'running'
      && instance.expiresAt !== null
      && instance.expiresAt.getTime() <= at.getTime()
    const ready = !expired
      && instance.desiredState === 'running'
      && currentGeneration
      && instance.observedState === 'running'
    const renewableAt = instance.desiredState === 'running' && instance.expiresAt
      ? new Date(instance.expiresAt.getTime() - this.policy.renewalWindowMs)
      : null
    let state: PlayerInstance['state']
    if (expired) state = 'expired'
    else if (instance.desiredState === 'stopped') {
      state = currentGeneration && instance.observedState === 'stopped' ? 'stopped' : 'stopping'
    }
    else if (!currentGeneration) state = 'pending'
    else state = instance.observedState

    return {
      id: instance.id,
      contest_id: instance.contestId,
      contest_challenge_id: instance.contestChallengeId,
      participation_id: instance.participationId,
      provider: instance.provider,
      state,
      desired_generation: instance.desiredGeneration,
      observed_generation: instance.observedGeneration,
      expires_at: instance.expiresAt?.toISOString() ?? null,
      renewable_at: renewableAt?.toISOString() ?? null,
      can_renew: ready && renewableAt !== null && renewableAt.getTime() <= at.getTime(),
      entrypoints: ready ? instance.entrypoints : [],
      last_observed_at: instance.lastObservedAt?.toISOString() ?? null,
      error: currentGeneration && ['failed', 'unknown'].includes(instance.observedState)
        && instance.lastErrorCode && instance.lastErrorSummary
        ? { code: instance.lastErrorCode, message: instance.lastErrorSummary }
        : null,
      version: instance.version,
    }
  }

  private publicPolicy(): PublicInstanceLeasePolicy {
    return {
      initial_duration_seconds: this.policy.initialDurationMs / 1000,
      extension_duration_seconds: this.policy.extensionDurationMs / 1000,
      renewal_window_seconds: this.policy.renewalWindowMs / 1000,
      team_active_limit: this.policy.teamActiveLimit,
    }
  }
}
