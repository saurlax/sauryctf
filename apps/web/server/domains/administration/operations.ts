import type {
  OperationalCommand,
  OperationalCommandKind,
  OperationalCommandResult,
} from '../../../shared/contracts/operations'
import { identityCapability, requireIdentityCapability } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'
import type { ScoreboardScope } from '../scoreboards/builder'

export interface OperationalCommandInput {
  requestId: string
  idempotencyKey: string
  kind: OperationalCommandKind
  targetId: string
  reason: string
}

export interface OperationalCommandRecordInput extends OperationalCommandInput {
  actorId: string
  at: Date
}

export interface OperationalCommandReservation {
  commandId: string
  replayed: OperationalCommand | null
}

export interface OperationalScoreboardContext {
  publicationStatus: 'draft' | 'published' | 'archived'
  visibility: 'public' | 'private'
  scopes: ScoreboardScope[]
}

export interface OperationalCommandRepository {
  executeDatabase(command: OperationalCommandRecordInput): Promise<OperationalCommand>
  reserveExternal(command: OperationalCommandRecordInput): Promise<OperationalCommandReservation>
  completeExternal(commandId: string, result: OperationalCommandResult, at: Date): Promise<OperationalCommand>
  failExternal(commandId: string, errorCode: string, at: Date): Promise<void>
  scoreboardContext(contestId: string): Promise<OperationalScoreboardContext>
  clearScoreboardSnapshots(contestId: string): Promise<number>
}

export interface OperationalScoreboardService {
  read(input: {
    contestId: string
    view: 'public' | 'internal'
    viewerRole: 'admin'
    scope: ScoreboardScope
  }): Promise<unknown>
}

export type OperationalCommandRepositoryErrorCode =
  | 'operations.idempotency_conflict'
  | 'operations.command_in_progress'
  | 'operations.command_failed'
  | 'operations.target_not_found'
  | 'operations.target_state_invalid'

export class OperationalCommandRepositoryError extends Error {
  constructor(readonly code: OperationalCommandRepositoryErrorCode) {
    super({
      'operations.idempotency_conflict': 'Idempotency-Key 已用于不同的运维命令',
      'operations.command_in_progress': '相同运维命令正在执行',
      'operations.command_failed': '相同运维命令此前执行失败，请使用新的 Idempotency-Key 重试',
      'operations.target_not_found': '运维目标不存在',
      'operations.target_state_invalid': '运维目标当前状态不允许执行该命令',
    }[code])
    this.name = 'OperationalCommandRepositoryError'
  }
}

export type AdministrationOperationsErrorCode = OperationalCommandRepositoryErrorCode
  | 'operations.execution_failed'

export class AdministrationOperationsError extends Error {
  constructor(readonly code: AdministrationOperationsErrorCode, message?: string) {
    super(message ?? {
      'operations.execution_failed': '运维命令执行失败',
      'operations.idempotency_conflict': 'Idempotency-Key 已用于不同的运维命令',
      'operations.command_in_progress': '相同运维命令正在执行',
      'operations.command_failed': '相同运维命令此前执行失败，请使用新的 Idempotency-Key 重试',
      'operations.target_not_found': '运维目标不存在',
      'operations.target_state_invalid': '运维目标当前状态不允许执行该命令',
    }[code])
    this.name = 'AdministrationOperationsError'
  }
}

export class AdministrationOperationsService {
  constructor(
    private readonly repository: OperationalCommandRepository,
    private readonly scoreboards: OperationalScoreboardService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(subject: SessionSubject, input: OperationalCommandInput): Promise<OperationalCommand> {
    requireIdentityCapability(subject, identityCapability.globalOperationsManage)
    const command: OperationalCommandRecordInput = {
      ...input,
      actorId: subject.userId,
      at: this.now(),
    }
    if (input.kind !== 'result_recalculate') {
      return this.mapRepository(() => this.repository.executeDatabase(command))
    }

    const reservation = await this.mapRepository(() => this.repository.reserveExternal(command))
    if (reservation.replayed) return reservation.replayed
    try {
      const context = await this.mapRepository(() => this.repository.scoreboardContext(input.targetId))
      const snapshotsCleared = await this.repository.clearScoreboardSnapshots(input.targetId)
      let projectionsRebuilt = 0
      for (const scope of context.scopes) {
        await this.scoreboards.read({
          contestId: input.targetId,
          view: 'internal',
          viewerRole: 'admin',
          scope,
        })
        projectionsRebuilt += 1
        if (context.publicationStatus !== 'draft' && context.visibility === 'public') {
          await this.scoreboards.read({
            contestId: input.targetId,
            view: 'public',
            viewerRole: 'admin',
            scope,
          })
          projectionsRebuilt += 1
        }
      }
      return await this.repository.completeExternal(reservation.commandId, {
        contest_id: input.targetId,
        snapshots_cleared: snapshotsCleared,
        projections_rebuilt: projectionsRebuilt,
      }, this.now())
    }
    catch (error) {
      const mapped = this.mapError(error)
      await this.repository.failExternal(reservation.commandId, mapped.code, this.now())
      throw mapped
    }
  }

  private async mapRepository<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    }
    catch (error) {
      throw this.mapError(error)
    }
  }

  private mapError(error: unknown): AdministrationOperationsError {
    if (error instanceof AdministrationOperationsError) return error
    if (error instanceof OperationalCommandRepositoryError) {
      return new AdministrationOperationsError(error.code, error.message)
    }
    return new AdministrationOperationsError('operations.execution_failed')
  }
}
