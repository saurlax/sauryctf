import type { FlagVerifier } from '../challenges/flag-verifier'
import {
  FlagVerificationConfigurationError,
  FlagValidatorExecutionError,
} from '../challenges/flag-verifier'
import { identityCapability, requireIdentityCapability } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'
import {
  SubmissionChallengeClosedError,
  SubmissionChallengeUnavailableError,
  SubmissionContestNotRunningError,
  SubmissionLimitReachedError,
  SubmissionParticipationNotAcceptedError,
  SubmissionTeamRequiredError,
  type SubmissionRepository,
} from './repository'

export interface SubmissionRateLimitDecision {
  allowed: boolean
  retryAfterMs: number
}

export interface SubmissionRateLimiter {
  consume(input: {
    scope: 'user' | 'team' | 'challenge'
    identity: string
    action: string
    limit: number
    windowMs: number
  }): Promise<SubmissionRateLimitDecision>
}

export type SubmissionServiceErrorCode =
  | 'challenge.flag_configuration_invalid'
  | 'challenge.flag_validator_failed'
  | 'challenge.not_found'
  | 'challenge.submission_closed'
  | 'challenge.submission_limit_reached'
  | 'contest.not_running'
  | 'participation.not_accepted'
  | 'security.rate_limited'
  | 'team.membership_required'

const errorMessages: Record<SubmissionServiceErrorCode, string> = {
  'challenge.flag_configuration_invalid': '题目 Flag 校验配置不可用',
  'challenge.flag_validator_failed': '题目 Flag 校验器暂时不可用',
  'challenge.not_found': '比赛题目不存在或尚未开放',
  'challenge.submission_closed': '该题目已停止接受正式提交',
  'challenge.submission_limit_reached': '该队伍已达到本题正式提交次数上限',
  'contest.not_running': '当前不在正式提交时间内',
  'participation.not_accepted': '当前队伍尚未获得比赛提交资格',
  'security.rate_limited': '请求过于频繁，请稍后重试',
  'team.membership_required': '请先加入队伍',
}

export class SubmissionServiceError extends Error {
  constructor(
    readonly code: SubmissionServiceErrorCode,
    readonly retryAfterMs = 0,
  ) {
    super(errorMessages[code])
    this.name = 'SubmissionServiceError'
  }
}

const minute = 60_000

export class SubmissionService {
  constructor(
    private readonly repository: SubmissionRepository,
    private readonly verifier: Pick<FlagVerifier, 'verify'>,
    private readonly rateLimiter: SubmissionRateLimiter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async verifyFlag(actor: SessionSubject, input: {
    contestId: string
    challengeId: string
    submittedFlag: string
  }): Promise<{ correct: boolean }> {
    requireIdentityCapability(actor, identityCapability.flagSubmit)

    await this.enforceLimits([
      {
        scope: 'user',
        identity: actor.userId,
        action: 'submission.flag',
        limit: 60,
        windowMs: minute,
      },
      {
        scope: 'user',
        identity: `${actor.userId}\0${input.challengeId}`,
        action: 'submission.flag.challenge',
        limit: 20,
        windowMs: minute,
      },
    ])

    const admission = await this.mapRepository(() => this.repository.admit({
      userId: actor.userId,
      contestId: input.contestId,
      challengeId: input.challengeId,
      at: this.now(),
    }))

    await this.enforceLimits([
      {
        scope: 'team',
        identity: admission.teamId,
        action: 'submission.flag',
        limit: 120,
        windowMs: minute,
      },
      {
        scope: 'team',
        identity: `${admission.teamId}\0${input.challengeId}`,
        action: 'submission.flag.challenge',
        limit: 30,
        windowMs: minute,
      },
      {
        scope: 'challenge',
        identity: input.challengeId,
        action: 'submission.flag',
        limit: 12_000,
        windowMs: minute,
      },
    ])

    try {
      return this.verifier.verify({
        contestId: admission.contestId,
        challengeId: admission.challengeId,
        teamId: admission.teamId,
        submittedFlag: input.submittedFlag,
        flagFormat: admission.flagFormat,
        policy: admission.flagPolicy,
      })
    }
    catch (error) {
      if (error instanceof FlagVerificationConfigurationError) {
        throw new SubmissionServiceError('challenge.flag_configuration_invalid')
      }
      if (error instanceof FlagValidatorExecutionError) {
        throw new SubmissionServiceError('challenge.flag_validator_failed')
      }
      throw error
    }
  }

  private async enforceLimits(inputs: Array<Parameters<SubmissionRateLimiter['consume']>[0]>) {
    for (const input of inputs) {
      const decision = await this.rateLimiter.consume(input)
      if (!decision.allowed) {
        throw new SubmissionServiceError('security.rate_limited', decision.retryAfterMs)
      }
    }
  }

  private async mapRepository<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    }
    catch (error) {
      if (error instanceof SubmissionTeamRequiredError) {
        throw new SubmissionServiceError('team.membership_required')
      }
      if (error instanceof SubmissionParticipationNotAcceptedError) {
        throw new SubmissionServiceError('participation.not_accepted')
      }
      if (error instanceof SubmissionContestNotRunningError) {
        throw new SubmissionServiceError('contest.not_running')
      }
      if (error instanceof SubmissionChallengeUnavailableError) {
        throw new SubmissionServiceError('challenge.not_found')
      }
      if (error instanceof SubmissionChallengeClosedError) {
        throw new SubmissionServiceError('challenge.submission_closed')
      }
      if (error instanceof SubmissionLimitReachedError) {
        throw new SubmissionServiceError('challenge.submission_limit_reached')
      }
      throw error
    }
  }
}
