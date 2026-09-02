import {
  operationalCommandSchema,
  type OperationalCommand,
  type OperationalCommandKind,
  type OperationalCommandResult,
} from '../../../shared/contracts/operations'
import {
  instanceJobPayloadVersion,
  instanceJobSchemaName,
  reconcileInstanceJobPayloadSchema,
} from '../../../shared/contracts/instance-jobs'
import {
  OperationalCommandRepositoryError,
  type OperationalCommandRecordInput,
  type OperationalCommandRepository,
  type OperationalCommandReservation,
  type OperationalScoreboardContext,
} from '../../domains/administration/operations'
import type { DatabaseExecutor } from './executor'

interface CommandRow {
  id: string
  kind: OperationalCommandKind
  target_id: string
  idempotency_key: string
  actor_user_id: string
  request_id: string
  reason: string
  status: 'pending' | 'succeeded' | 'failed'
  result: OperationalCommandResult | null
  error_code: string | null
  completed_at: Date | null
}

interface InstanceReconcileRow {
  id: string
  contest_id: string
  contest_challenge_id: string
  participation_id: string
  team_id: string
  provider: 'docker' | 'kubernetes'
  desired_state: 'running' | 'stopped'
  desired_generation: string
  expires_at: Date | null
  runtime_spec: unknown
}

const commandProjection = `
  id::text, kind::text, target_id::text, idempotency_key,
  actor_user_id::text, request_id, reason, status::text,
  result, error_code, completed_at`

export class PostgresOperationalCommandRepository implements OperationalCommandRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async executeDatabase(command: OperationalCommandRecordInput): Promise<OperationalCommand> {
    return this.transaction(async (connection) => {
      const claimed = await this.claim(connection, command)
      if (claimed.replayed) return claimed.replayed
      let result: OperationalCommandResult
      if (command.kind === 'dead_letter_replay') {
        result = await this.replayDeadLetter(connection, command.targetId, command.at)
      }
      else if (command.kind === 'instance_reconcile') {
        result = await this.enqueueReconcile(connection, command.targetId, command.at)
      }
      else if (command.kind === 'session_invalidate') {
        result = await this.invalidateSessions(connection, command.targetId, command.at)
      }
      else {
        throw new OperationalCommandRepositoryError('operations.target_state_invalid')
      }
      const completed = await this.complete(connection, claimed.commandId, result, command.at)
      await this.writeAudit(connection, completed, 'succeeded', null)
      return project(completed, false)
    })
  }

  async reserveExternal(command: OperationalCommandRecordInput): Promise<OperationalCommandReservation> {
    return this.transaction(connection => this.claim(connection, command))
  }

  async completeExternal(
    commandId: string,
    result: OperationalCommandResult,
    at: Date,
  ): Promise<OperationalCommand> {
    return this.transaction(async (connection) => {
      const completed = await this.complete(connection, commandId, result, at)
      await this.writeAudit(connection, completed, 'succeeded', null)
      return project(completed, false)
    })
  }

  async failExternal(commandId: string, errorCode: string, at: Date): Promise<void> {
    await this.transaction(async (connection) => {
      const failed = await connection.query<CommandRow>(`
        UPDATE operational_commands
        SET status = 'failed', error_code = $2, completed_at = $3
        WHERE id = $1 AND status = 'pending'
        RETURNING ${commandProjection}`, [commandId, errorCode, at])
      if (!failed.rows[0]) return
      await this.writeAudit(connection, failed.rows[0], 'failed', errorCode)
    })
  }

  async scoreboardContext(contestId: string): Promise<OperationalScoreboardContext> {
    const contest = await this.database.query<{
      publication_status: OperationalScoreboardContext['publicationStatus']
      visibility: OperationalScoreboardContext['visibility']
    }>(`
      SELECT publication_status::text, visibility::text
      FROM contests WHERE id = $1`, [contestId])
    if (!contest.rows[0]) throw new OperationalCommandRepositoryError('operations.target_not_found')
    const divisions = await this.database.query<{ id: string }>(`
      SELECT id::text FROM divisions WHERE contest_id = $1 ORDER BY sort_order, id`, [contestId])
    return {
      publicationStatus: contest.rows[0].publication_status,
      visibility: contest.rows[0].visibility,
      scopes: [
        { type: 'overall' },
        ...divisions.rows.map(row => ({ type: 'division' as const, divisionId: row.id })),
      ],
    }
  }

  async clearScoreboardSnapshots(contestId: string): Promise<number> {
    const result = await this.database.query('DELETE FROM scoreboard_snapshots WHERE contest_id = $1', [contestId])
    return result.rowCount ?? 0
  }

  private async claim(
    connection: DatabaseExecutor,
    command: OperationalCommandRecordInput,
  ): Promise<OperationalCommandReservation> {
    const inserted = await connection.query<CommandRow>(`
      INSERT INTO operational_commands
        (kind, target_id, idempotency_key, actor_user_id, request_id, reason, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING ${commandProjection}`, [
      command.kind,
      command.targetId,
      command.idempotencyKey,
      command.actorId,
      command.requestId,
      command.reason,
      command.at,
    ])
    if (inserted.rows[0]) return { commandId: inserted.rows[0].id, replayed: null }

    const existing = await connection.query<CommandRow>(`
      SELECT ${commandProjection}
      FROM operational_commands WHERE idempotency_key = $1
      FOR UPDATE`, [command.idempotencyKey])
    const row = existing.rows[0]
    if (!row
      || row.kind !== command.kind
      || row.target_id !== command.targetId
      || row.actor_user_id !== command.actorId
      || row.reason !== command.reason) {
      throw new OperationalCommandRepositoryError('operations.idempotency_conflict')
    }
    if (row.status === 'succeeded') {
      return { commandId: row.id, replayed: project(row, true) }
    }
    if (row.status === 'failed') {
      throw new OperationalCommandRepositoryError('operations.command_failed')
    }
    throw new OperationalCommandRepositoryError('operations.command_in_progress')
  }

  private async replayDeadLetter(
    connection: DatabaseExecutor,
    jobId: string,
    at: Date,
  ): Promise<OperationalCommandResult> {
    const replayed = await connection.query<{
      id: string
      attempt_count: number
      max_attempts: number
    }>(`
      UPDATE instance_jobs AS job
      SET status = 'ready', available_at = $2,
          lease_owner = NULL, lease_until = NULL,
          max_attempts = greatest(job.max_attempts, job.attempt_count + 1),
          error_code = NULL, error_summary = NULL, finished_at = NULL
      FROM instances AS instance
      WHERE job.id = $1 AND job.instance_id = instance.id
        AND job.status = 'dead'
        AND job.desired_generation = instance.desired_generation
      RETURNING job.id::text, job.attempt_count, job.max_attempts`, [jobId, at])
    if (!replayed.rows[0]) await this.requireInstanceJobTargetState(connection, jobId)
    const row = replayed.rows[0]!
    return {
      job_id: row.id,
      next_attempt: row.attempt_count + 1,
      max_attempts: row.max_attempts,
    }
  }

  private async enqueueReconcile(
    connection: DatabaseExecutor,
    instanceId: string,
    at: Date,
  ): Promise<OperationalCommandResult> {
    const instance = await connection.query<InstanceReconcileRow>(`
      SELECT instance.id::text, instance.contest_id::text,
        instance.contest_challenge_id::text, instance.participation_id::text,
        participation.team_id::text, instance.provider::text,
        instance.desired_state::text, instance.desired_generation::text,
        instance.expires_at, source.payload->'spec' AS runtime_spec
      FROM instances AS instance
      JOIN participations AS participation ON participation.id = instance.participation_id
      LEFT JOIN LATERAL (
        SELECT job.payload FROM instance_jobs AS job
        WHERE job.instance_id = instance.id
          AND job.desired_generation = instance.desired_generation
          AND job.operation = 'ensure'
        ORDER BY job.created_at DESC, job.id DESC
        LIMIT 1
      ) AS source ON true
      WHERE instance.id = $1
      FOR UPDATE OF instance`, [instanceId])
    const row = instance.rows[0]
    if (!row) throw new OperationalCommandRepositoryError('operations.target_not_found')
    const desiredGeneration = safeInteger(row.desired_generation)
    const payload = reconcileInstanceJobPayloadSchema.parse({
      schema: instanceJobSchemaName,
      provider: row.provider,
      target: {
        contest_id: row.contest_id,
        contest_challenge_id: row.contest_challenge_id,
        participation_id: row.participation_id,
        team_id: row.team_id,
      },
      expires_at: row.expires_at?.toISOString() ?? null,
      desired_state: row.desired_state,
      spec: row.desired_state === 'running' ? row.runtime_spec : null,
    })
    const queued = await connection.query<{ id: string, attempt_count: number, max_attempts: number }>(`
      INSERT INTO instance_jobs
        (instance_id, operation, payload_version, payload, desired_generation,
         idempotency_key, status, available_at)
      VALUES ($1, 'reconcile', $2, $3, $4, $5, 'ready', $6)
      ON CONFLICT (instance_id, desired_generation, operation) DO UPDATE
      SET payload_version = excluded.payload_version,
          payload = excluded.payload,
          status = 'ready', available_at = excluded.available_at,
          lease_owner = NULL, lease_until = NULL,
          max_attempts = greatest(instance_jobs.max_attempts, instance_jobs.attempt_count + 1),
          error_code = NULL, error_summary = NULL, finished_at = NULL
      WHERE instance_jobs.status <> 'leased'
      RETURNING instance_jobs.id::text, instance_jobs.attempt_count, instance_jobs.max_attempts`, [
      row.id,
      instanceJobPayloadVersion,
      payload,
      desiredGeneration,
      `instance:${row.id}:generation:${desiredGeneration}:reconcile`,
      at,
    ])
    if (!queued.rows[0]) throw new OperationalCommandRepositoryError('operations.target_state_invalid')
    return {
      instance_id: row.id,
      job_id: queued.rows[0].id,
      desired_generation: desiredGeneration,
      next_attempt: queued.rows[0].attempt_count + 1,
    }
  }

  private async invalidateSessions(
    connection: DatabaseExecutor,
    userId: string,
    at: Date,
  ): Promise<OperationalCommandResult> {
    const invalidated = await connection.query<{ id: string, session_version: string }>(`
      UPDATE users
      SET session_version = session_version + 1,
          version = version + 1,
          updated_at = $2
      WHERE id = $1
      RETURNING id::text, session_version::text`, [userId, at])
    if (!invalidated.rows[0]) throw new OperationalCommandRepositoryError('operations.target_not_found')
    return {
      user_id: invalidated.rows[0].id,
      session_version: safeInteger(invalidated.rows[0].session_version),
    }
  }

  private async requireInstanceJobTargetState(connection: DatabaseExecutor, id: string): Promise<never> {
    const existing = await connection.query('SELECT 1 FROM instance_jobs WHERE id = $1', [id])
    throw new OperationalCommandRepositoryError(
      existing.rows[0] ? 'operations.target_state_invalid' : 'operations.target_not_found',
    )
  }

  private async complete(
    connection: DatabaseExecutor,
    commandId: string,
    result: OperationalCommandResult,
    at: Date,
  ): Promise<CommandRow> {
    const completed = await connection.query<CommandRow>(`
      UPDATE operational_commands
      SET status = 'succeeded', result = $2, completed_at = $3
      WHERE id = $1 AND status = 'pending'
      RETURNING ${commandProjection}`, [commandId, result, at])
    if (!completed.rows[0]) throw new OperationalCommandRepositoryError('operations.command_in_progress')
    return completed.rows[0]
  }

  private async writeAudit(
    connection: DatabaseExecutor,
    command: CommandRow,
    outcome: 'succeeded' | 'failed',
    errorCode: string | null,
  ): Promise<void> {
    await connection.query(`
      INSERT INTO audit_events
        (actor_user_id, action, target_type, target_id, reason,
         outcome, request_id, changes, metadata, occurred_at)
      VALUES ($1, $2, 'operational_command', $3, $4, $5, $6, $7, $8, $9)`, [
      command.actor_user_id,
      `operations.${command.kind}`,
      command.id,
      command.reason,
      outcome,
      command.request_id,
      command.result ?? {},
      {
        command_kind: command.kind,
        target_id: command.target_id,
        idempotency_key: command.idempotency_key,
        error_code: errorCode,
      },
      command.completed_at,
    ])
  }

  private async transaction<T>(operation: (connection: DatabaseExecutor) => Promise<T>): Promise<T> {
    return this.database.transaction(operation)
  }
}

function project(row: CommandRow, replayed: boolean): OperationalCommand {
  return operationalCommandSchema.parse({
    id: row.id,
    kind: row.kind,
    target_id: row.target_id,
    status: row.status,
    replayed,
    completed_at: row.completed_at?.toISOString(),
    result: row.result,
  })
}

function safeInteger(value: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) throw new RangeError('Operational result exceeded safe integer range')
  return number
}
