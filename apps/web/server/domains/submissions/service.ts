import type { FlagVerifier } from '../challenges/flag-verifier'
import {
  FlagVerificationConfigurationError,
  FlagValidatorExecutionError,
} from '../challenges/flag-verifier'
import { identityCapability, requireIdentityCapability } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'
import type { SubmissionAnswerProtector } from './answer-protection'
import {
  CheatClueCursorInvalidError,
  CheatClueNotFoundError,
  CheatClueRequestConflictError,
  CheatClueReviewConflictError,
  SubmissionChallengeClosedError,
  SubmissionChallengeUnavailableError,
  SubmissionContestNotRunningError,
  SubmissionLimitReachedError,
  SubmissionCursorInvalidError,
  SubmissionContestNotFoundError,
  SubmissionParticipationNotAcceptedError,
  SubmissionParticipationNotFoundError,
  SubmissionRequestConflictError,
  SubmissionTeamRequiredError,
  ScoreAdjustmentArchivedContestError,
  ScoreAdjustmentRequestConflictError,
  type SubmissionRepository,
  type CheatClueStatus,
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
  consumeMany?(inputs: Array<Parameters<SubmissionRateLimiter['consume']>[0]>): Promise<SubmissionRateLimitDecision[]>
}

export type SubmissionServiceErrorCode =
  | 'cheat_clue.cursor_invalid'
  | 'cheat_clue.not_found'
  | 'cheat_clue.request_conflict'
  | 'cheat_clue.review_conflict'
  | 'cheat_clue.review_note_required'
  | 'challenge.flag_configuration_invalid'
  | 'challenge.flag_validator_failed'
  | 'challenge.not_found'
  | 'challenge.submission_closed'
  | 'challenge.submission_limit_reached'
  | 'contest.not_running'
  | 'contest.not_found'
  | 'participation.not_accepted'
  | 'participation.not_found'
  | 'security.rate_limited'
  | 'score.adjustment_confirmation_required'
  | 'score.adjustment_invalid'
  | 'score.adjustment_not_allowed'
  | 'score.adjustment_reason_required'
  | 'score.adjustment_request_conflict'
  | 'team.membership_required'
  | 'submission.cursor_invalid'
  | 'submission.request_conflict'

const errorMessages: Record<SubmissionServiceErrorCode, string> = {
  'cheat_clue.cursor_invalid': '反作弊线索游标无效或已经过期',
  'cheat_clue.not_found': '反作弊线索不存在',
  'cheat_clue.request_conflict': '请求标识已被其他反作弊复核使用',
  'cheat_clue.review_conflict': '反作弊线索当前状态不允许该复核操作',
  'cheat_clue.review_note_required': '最终复核结论必须填写至少 10 个字符的备注',
  'challenge.flag_configuration_invalid': '题目 Flag 校验配置不可用',
  'challenge.flag_validator_failed': '题目 Flag 校验器暂时不可用',
  'challenge.not_found': '比赛题目不存在或尚未开放',
  'challenge.submission_closed': '该题目已停止接受正式提交',
  'challenge.submission_limit_reached': '该队伍已达到本题正式提交次数上限',
  'contest.not_running': '当前不在正式提交时间内',
  'contest.not_found': '比赛不存在',
  'participation.not_accepted': '当前队伍尚未获得比赛提交资格',
  'participation.not_found': '比赛参赛记录不存在',
  'security.rate_limited': '请求过于频繁，请稍后重试',
  'score.adjustment_confirmation_required': '成绩调整需要明确确认',
  'score.adjustment_invalid': '成绩调整分值必须是非零且不超过一百万的整数',
  'score.adjustment_not_allowed': '归档比赛不允许调整成绩',
  'score.adjustment_reason_required': '成绩调整必须填写至少 10 个字符的原因',
  'score.adjustment_request_conflict': '请求标识已被其他成绩调整使用',
  'team.membership_required': '请先加入队伍',
  'submission.cursor_invalid': '提交记录游标无效或已经过期',
  'submission.request_conflict': '请求标识已被其他提交使用',
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
    private readonly answers: SubmissionAnswerProtector,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async verifyFlag(actor: SessionSubject, input: {
    contestId: string
    challengeId: string
    submittedFlag: string
    requestId: string
  }): Promise<{
      correct: boolean
      result: 'correct' | 'incorrect' | 'already_solved'
      mode: 'official' | 'practice'
    }> {
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
      const verdict = this.verifier.verify({
        contestId: admission.contestId,
        challengeId: admission.challengeId,
        teamId: admission.teamId,
        submittedFlag: input.submittedFlag,
        flagFormat: admission.flagFormat,
        policy: admission.flagPolicy,
      })
      const protectedAnswer = this.answers.protect(input.submittedFlag, {
        contestId: admission.contestId,
        challengeId: admission.challengeId,
        participationId: admission.participationId,
        teamId: admission.teamId,
        userId: actor.userId,
        requestId: input.requestId,
      })
      const submission = await this.mapRepository(() => this.repository.append({
        userId: actor.userId,
        contestId: admission.contestId,
        challengeId: admission.challengeId,
        at: this.now(),
        requestId: input.requestId,
        result: verdict.correct ? 'correct' : 'incorrect',
        answerDigest: protectedAnswer.digest,
        answerCiphertext: protectedAnswer.ciphertext,
      }))
      return { correct: verdict.correct, result: submission.result, mode: submission.mode }
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

  async listManaged(
    actor: SessionSubject,
    contestId: string,
    cursor: string | undefined,
    limit: number,
  ) {
    requireIdentityCapability(actor, identityCapability.contestJudge)
    return this.mapRepository(() => this.repository.listManaged(contestId, cursor, limit))
  }

  async recordScoreAdjustment(actor: SessionSubject, input: {
    contestId: string
    participationId: string
    pointsDelta: number
    reason: string
    confirmed: boolean
    requestId: string
  }) {
    requireIdentityCapability(actor, identityCapability.contestJudge)
    if (!input.confirmed) {
      throw new SubmissionServiceError('score.adjustment_confirmation_required')
    }
    if (!Number.isSafeInteger(input.pointsDelta)
      || input.pointsDelta === 0
      || Math.abs(input.pointsDelta) > 1_000_000) {
      throw new SubmissionServiceError('score.adjustment_invalid')
    }
    const reason = input.reason.trim()
    if (reason.length < 10 || reason.length > 1000) {
      throw new SubmissionServiceError('score.adjustment_reason_required')
    }
    return this.mapRepository(() => this.repository.recordScoreAdjustment({
      actorId: actor.userId,
      contestId: input.contestId,
      participationId: input.participationId,
      pointsDelta: input.pointsDelta,
      reason,
      requestId: input.requestId,
      at: this.now(),
    }))
  }

  async listCheatClues(
    actor: SessionSubject,
    contestId: string,
    status: CheatClueStatus | undefined,
    cursor: string | undefined,
    limit: number,
  ) {
    requireIdentityCapability(actor, identityCapability.contestJudge)
    return this.mapRepository(() => this.repository.listCheatClues(
      contestId,
      status,
      cursor,
      limit,
    ))
  }

  async reviewCheatClue(actor: SessionSubject, input: {
    contestId: string
    clueId: string
    status: Exclude<CheatClueStatus, 'open'>
    note: string | null
    requestId: string
  }) {
    requireIdentityCapability(actor, identityCapability.contestJudge)
    const note = input.note?.trim() || null
    const finalReview = input.status === 'dismissed' || input.status === 'confirmed'
    if ((finalReview && (note?.length ?? 0) < 10) || (note?.length ?? 0) > 1000) {
      throw new SubmissionServiceError('cheat_clue.review_note_required')
    }
    return this.mapRepository(() => this.repository.reviewCheatClue({
      actorId: actor.userId,
      contestId: input.contestId,
      clueId: input.clueId,
      status: input.status,
      note,
      requestId: input.requestId,
      at: this.now(),
    }))
  }

  private async enforceLimits(inputs: Array<Parameters<SubmissionRateLimiter['consume']>[0]>) {
    const decisions = this.rateLimiter.consumeMany
      ? await this.rateLimiter.consumeMany(inputs)
      : await Promise.all(inputs.map(input => this.rateLimiter.consume(input)))
    const retryAfterMs = decisions.reduce(
      (maximum, decision) => decision.allowed ? maximum : Math.max(maximum, decision.retryAfterMs),
      0,
    )
    if (retryAfterMs > 0) {
      throw new SubmissionServiceError('security.rate_limited', retryAfterMs)
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
      if (error instanceof SubmissionParticipationNotFoundError) {
        throw new SubmissionServiceError('participation.not_found')
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
      if (error instanceof SubmissionRequestConflictError) {
        throw new SubmissionServiceError('submission.request_conflict')
      }
      if (error instanceof ScoreAdjustmentRequestConflictError) {
        throw new SubmissionServiceError('score.adjustment_request_conflict')
      }
      if (error instanceof ScoreAdjustmentArchivedContestError) {
        throw new SubmissionServiceError('score.adjustment_not_allowed')
      }
      if (error instanceof SubmissionCursorInvalidError) {
        throw new SubmissionServiceError('submission.cursor_invalid')
      }
      if (error instanceof SubmissionContestNotFoundError) {
        throw new SubmissionServiceError('contest.not_found')
      }
      if (error instanceof CheatClueNotFoundError) {
        throw new SubmissionServiceError('cheat_clue.not_found')
      }
      if (error instanceof CheatClueCursorInvalidError) {
        throw new SubmissionServiceError('cheat_clue.cursor_invalid')
      }
      if (error instanceof CheatClueReviewConflictError) {
        throw new SubmissionServiceError('cheat_clue.review_conflict')
      }
      if (error instanceof CheatClueRequestConflictError) {
        throw new SubmissionServiceError('cheat_clue.request_conflict')
      }
      throw error
    }
  }
}
