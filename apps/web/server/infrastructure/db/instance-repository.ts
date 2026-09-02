import { dynamicInstancePolicySchema, type ChallengeInstancePolicy } from '../../../shared/contracts/challenges'
import {
  destroyInstanceJobPayloadSchema,
  ensureInstanceJobPayloadSchema,
  instanceJobPayloadVersion,
  instanceJobSchemaName,
  type DestroyInstanceJobPayload,
  type EnsureInstanceJobPayload,
} from '../../../shared/contracts/instance-jobs'
import { instanceEntrypointSchema } from '../../../shared/contracts/instances'
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
  type InstanceCommand,
  type InstanceRecord,
  type InstanceRepository,
} from '../../domains/instances/repository'
import type { ControlPlaneTelemetry, InstanceJobCorrelation } from '../telemetry/telemetry'
import type { DatabaseExecutor } from './executor'

interface CommandContextRow {
  participation_id: string
  team_id: string
  participation_status: 'pending' | 'accepted' | 'rejected' | 'withdrawn'
  publication_status: 'draft' | 'published' | 'archived'
  contest_phase: 'upcoming' | 'running' | 'ended'
  practice_enabled: boolean
  challenge_enabled: boolean
  publish_at: Date | null
  close_at: Date | null
  instance_policy: ChallengeInstancePolicy
}

interface InstanceRow {
  id: string
  contest_id: string
  contest_challenge_id: string
  participation_id: string
  provider: 'docker' | 'kubernetes'
  desired_state: 'running' | 'stopped'
  desired_generation: string
  observed_state: 'pending' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'unknown'
  observed_generation: string
  expires_at: Date | null
  entrypoints: unknown
  last_observed_at: Date | null
  last_error_code: string | null
  last_error_summary: string | null
  version: string
}

const instanceProjection = `
  id::text, contest_id::text, contest_challenge_id::text, participation_id::text,
  provider::text, desired_state::text, desired_generation::text,
  observed_state::text, observed_generation::text, expires_at, entrypoints,
  last_observed_at, last_error_code, last_error_summary, version::text`

export class PostgresInstanceRepository implements InstanceRepository {
  constructor(
    private readonly database: DatabaseExecutor,
    private readonly telemetry?: Pick<ControlPlaneTelemetry, 'instanceJobQueued'>,
  ) {}

  async read(command: Omit<InstanceCommand, 'requestId'>): Promise<InstanceRecord | null> {
    return this.database.transaction(async (connection) => {
      const context = await this.commandContext(connection, command, false)
      this.assertParticipation(context)
      this.assertDynamicChallenge(context)
      const result = await connection.query<InstanceRow>(`
        SELECT ${instanceProjection}
        FROM instances
        WHERE participation_id = $1 AND contest_challenge_id = $2`, [
        context.participation_id,
        command.challengeId,
      ])
      return result.rows[0] ? record(result.rows[0]) : null
    })
  }

  async start(command: InstanceCommand): Promise<InstanceRecord> {
    const completed = await this.transaction(async (connection) => {
      const context = await this.commandContext(connection, command, true)
      this.assertCanOperate(context, command.at)
      const policy = this.dynamicPolicy(context)
      const current = await this.lockInstance(connection, context.participation_id, command.challengeId)
      if (current?.desired_state === 'running'
        && current.expires_at !== null
        && current.expires_at.getTime() > command.at.getTime()) {
        return { instance: record(current), correlation: null }
      }

      const active = await connection.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM instances
        WHERE participation_id = $1 AND desired_state = 'running'
          AND expires_at > $2`, [context.participation_id, command.at])
      if (Number(active.rows[0]!.count) >= command.policy.teamActiveLimit) {
        throw new InstanceQuotaExceededError()
      }

      const expiresAt = new Date(command.at.getTime() + command.policy.initialDurationMs)
      let row: InstanceRow
      if (current) {
        const updated = await connection.query<InstanceRow>(`
          UPDATE instances
          SET provider = $2, desired_state = 'running',
              desired_generation = desired_generation + 1,
              observed_state = 'pending', expires_at = $3,
              provider_resource_id = NULL, entrypoints = '[]'::jsonb,
              access_ciphertext = NULL, last_error_code = NULL,
              last_error_summary = NULL, version = version + 1,
              updated_at = clock_timestamp()
          WHERE id = $1
          RETURNING ${instanceProjection}`, [current.id, policy.provider, expiresAt])
        row = updated.rows[0]!
      }
      else {
        const inserted = await connection.query<InstanceRow>(`
          INSERT INTO instances
            (contest_id, contest_challenge_id, participation_id, provider,
             desired_state, desired_generation, observed_state,
             observed_generation, expires_at)
          VALUES ($1, $2, $3, $4, 'running', 1, 'pending', 0, $5)
          RETURNING ${instanceProjection}`, [
          command.contestId,
          command.challengeId,
          context.participation_id,
          policy.provider,
          expiresAt,
        ])
        row = inserted.rows[0]!
      }
      const jobId = await this.enqueueEnsure(connection, row, context, policy, expiresAt)
      await this.writeAudit(connection, command, row, 'instance.started', '选手启动题目实例', {
        expires_at: expiresAt.toISOString(),
        desired_generation: Number(row.desired_generation),
      })
      return {
        instance: record(row),
        correlation: jobCorrelation(command, row, context, 'ensure', jobId),
      }
    })
    if (completed.correlation) this.telemetry?.instanceJobQueued(completed.correlation)
    return completed.instance
  }

  async renew(command: InstanceCommand): Promise<InstanceRecord> {
    const completed = await this.transaction(async (connection) => {
      const context = await this.commandContext(connection, command, true)
      this.assertCanOperate(context, command.at)
      const policy = this.dynamicPolicy(context)
      const current = await this.lockInstance(connection, context.participation_id, command.challengeId)
      if (!current || current.desired_state !== 'running' || !current.expires_at
        || current.expires_at.getTime() <= command.at.getTime()) {
        throw new InstanceNotRunningError()
      }
      const renewableAt = new Date(current.expires_at.getTime() - command.policy.renewalWindowMs)
      if (command.at.getTime() < renewableAt.getTime()) {
        throw new InstanceRenewalTooEarlyError(renewableAt)
      }
      const expiresAt = new Date(current.expires_at.getTime() + command.policy.extensionDurationMs)
      const updated = await connection.query<InstanceRow>(`
        UPDATE instances
        SET desired_generation = desired_generation + 1,
            observed_state = 'pending', expires_at = $2,
            provider_resource_id = NULL, entrypoints = '[]'::jsonb,
            access_ciphertext = NULL, last_error_code = NULL,
            last_error_summary = NULL, version = version + 1,
            updated_at = clock_timestamp()
        WHERE id = $1
        RETURNING ${instanceProjection}`, [current.id, expiresAt])
      const row = updated.rows[0]!
      const jobId = await this.enqueueEnsure(connection, row, context, policy, expiresAt)
      await this.writeAudit(connection, command, row, 'instance.renewed', '选手续期题目实例', {
        previous_expires_at: current.expires_at.toISOString(),
        expires_at: expiresAt.toISOString(),
        desired_generation: Number(row.desired_generation),
      })
      return {
        instance: record(row),
        correlation: jobCorrelation(command, row, context, 'ensure', jobId),
      }
    })
    this.telemetry?.instanceJobQueued(completed.correlation)
    return completed.instance
  }

  async destroy(command: InstanceCommand): Promise<InstanceRecord> {
    const completed = await this.transaction(async (connection) => {
      const context = await this.commandContext(connection, command, true)
      const current = await this.lockInstance(connection, context.participation_id, command.challengeId)
      if (!current) throw new InstanceUnavailableError()
      if (current.desired_state === 'stopped') return { instance: record(current), correlation: null }

      const generation = Number(current.desired_generation) + 1
      const updated = await connection.query<InstanceRow>(`
        UPDATE instances
        SET desired_state = 'stopped', desired_generation = $2,
            observed_state = 'stopping', expires_at = NULL,
            entrypoints = '[]'::jsonb, access_ciphertext = NULL,
            last_error_code = NULL, last_error_summary = NULL,
            version = version + 1, updated_at = clock_timestamp()
        WHERE id = $1
        RETURNING ${instanceProjection}`, [current.id, generation])
      const row = updated.rows[0]!
      const payload = destroyPayload(row, context)
      const jobId = await this.enqueue(connection, row, 'destroy', payload)
      await this.writeAudit(connection, command, row, 'instance.destroyed', '选手销毁题目实例', {
        desired_generation: generation,
      })
      return {
        instance: record(row),
        correlation: jobCorrelation(command, row, context, 'destroy', jobId),
      }
    })
    if (completed.correlation) this.telemetry?.instanceJobQueued(completed.correlation)
    return completed.instance
  }

  private async transaction<T>(operation: (connection: DatabaseExecutor) => Promise<T>): Promise<T> {
    return this.database.transaction(operation)
  }

  private async commandContext(
    connection: DatabaseExecutor,
    command: Pick<InstanceCommand, 'actorId' | 'contestId' | 'challengeId' | 'at'>,
    lock: boolean,
  ): Promise<CommandContextRow> {
    const membership = await connection.query<{ team_id: string }>(`
      SELECT team_id::text FROM team_members WHERE user_id = $1 ${lock ? 'FOR SHARE' : ''}`,
    [command.actorId])
    if (!membership.rows[0]) throw new InstanceTeamRequiredError()
    const result = await connection.query<CommandContextRow>(`
      SELECT participation.id::text AS participation_id,
             participation.team_id::text AS team_id,
             participation.status::text AS participation_status,
             contest.publication_status::text AS publication_status,
             CASE WHEN contest.publication_status = 'archived' THEN 'ended'::contest_time_phase
                  ELSE derive_contest_time_phase(contest.start_at, contest.end_at, $4)
             END::text AS contest_phase,
             contest.practice_enabled,
             challenge.enabled AS challenge_enabled,
             challenge.publish_at, challenge.close_at, challenge.instance_policy
      FROM participations participation
      JOIN contests contest ON contest.id = participation.contest_id
      JOIN contest_challenges challenge ON challenge.contest_id = contest.id
      WHERE participation.team_id = $1 AND contest.id = $2 AND challenge.id = $3
      ${lock ? 'FOR UPDATE OF participation, contest, challenge' : ''}`, [
      membership.rows[0].team_id,
      command.contestId,
      command.challengeId,
      command.at,
    ])
    if (!result.rows[0]) throw new InstanceUnavailableError()
    return result.rows[0]
  }

  private assertParticipation(context: CommandContextRow) {
    if (context.participation_status !== 'accepted') {
      throw new InstanceParticipationNotAcceptedError()
    }
  }

  private assertDynamicChallenge(context: CommandContextRow) {
    if (!context.challenge_enabled || dynamicInstancePolicySchema.safeParse(context.instance_policy).success === false) {
      throw new InstanceChallengeNotAvailableError()
    }
  }

  private assertCanOperate(context: CommandContextRow, at: Date) {
    this.assertParticipation(context)
    this.assertDynamicChallenge(context)
    if (context.publication_status !== 'published'
      || context.contest_phase === 'upcoming'
      || (context.contest_phase === 'ended' && !context.practice_enabled)) {
      throw new InstanceContestNotAvailableError()
    }
    if (context.publish_at && context.publish_at.getTime() > at.getTime()) {
      throw new InstanceChallengeNotAvailableError()
    }
    if (context.contest_phase === 'running' && context.close_at && context.close_at.getTime() <= at.getTime()) {
      throw new InstanceChallengeNotAvailableError()
    }
  }

  private dynamicPolicy(context: CommandContextRow) {
    const parsed = dynamicInstancePolicySchema.safeParse(context.instance_policy)
    if (!parsed.success) throw new InstanceConfigurationInvalidError(context.instance_policy)
    return parsed.data
  }

  private async lockInstance(connection: DatabaseExecutor, participationId: string, challengeId: string) {
    const result = await connection.query<InstanceRow>(`
      SELECT ${instanceProjection} FROM instances
      WHERE participation_id = $1 AND contest_challenge_id = $2
      FOR UPDATE`, [participationId, challengeId])
    return result.rows[0] ?? null
  }

  private async enqueueEnsure(
    connection: DatabaseExecutor,
    row: InstanceRow,
    context: CommandContextRow,
    policy: ReturnType<typeof dynamicInstancePolicySchema.parse>,
    expiresAt: Date,
  ): Promise<string> {
    const payload = ensurePayload(row, context, policy, expiresAt)
    return this.enqueue(connection, row, 'ensure', payload)
  }

  private async enqueue(
    connection: DatabaseExecutor,
    row: InstanceRow,
    operation: 'ensure' | 'destroy',
    payload: EnsureInstanceJobPayload | DestroyInstanceJobPayload,
  ): Promise<string> {
    const generation = Number(row.desired_generation)
    const result = await connection.query<{ id: string }>(`
      INSERT INTO instance_jobs
        (instance_id, operation, payload_version, payload,
         desired_generation, idempotency_key)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id::text AS id`, [
      row.id,
      operation,
      instanceJobPayloadVersion,
      payload,
      generation,
      `instance:${row.id}:${generation}:${operation}`,
    ])
    return result.rows[0]!.id
  }

  private async writeAudit(
    connection: DatabaseExecutor,
    command: InstanceCommand,
    row: InstanceRow,
    action: string,
    reason: string,
    changes: Record<string, unknown>,
  ) {
    await connection.query(`
      INSERT INTO audit_events
        (actor_user_id, action, target_type, target_id, reason,
         outcome, request_id, changes, metadata)
      VALUES ($1, $2, 'instance', $3, $4, 'succeeded', $5, $6, $7)`, [
      command.actorId,
      action,
      row.id,
      reason,
      command.requestId,
      changes,
      { contest_id: command.contestId, contest_challenge_id: command.challengeId },
    ])
  }
}

function jobCorrelation(
  command: InstanceCommand,
  row: InstanceRow,
  context: CommandContextRow,
  operation: InstanceJobCorrelation['operation'],
  jobId: string,
): InstanceJobCorrelation {
  return {
    requestId: command.requestId,
    jobId,
    instanceId: row.id,
    contestId: command.contestId,
    challengeId: command.challengeId,
    teamId: context.team_id,
    operation,
    provider: row.provider,
  }
}

function target(row: InstanceRow, context: CommandContextRow) {
  return {
    contest_id: row.contest_id,
    contest_challenge_id: row.contest_challenge_id,
    participation_id: row.participation_id,
    team_id: context.team_id,
  }
}

function ensurePayload(
  row: InstanceRow,
  context: CommandContextRow,
  policy: ReturnType<typeof dynamicInstancePolicySchema.parse>,
  expiresAt: Date,
): EnsureInstanceJobPayload {
  try {
    return ensureInstanceJobPayloadSchema.parse({
      schema: instanceJobSchemaName,
      provider: policy.provider,
      target: target(row, context),
      expires_at: expiresAt.toISOString(),
      spec: {
        image: policy.image,
        entrypoints: [{
          name: 'main',
          protocol: policy.entry_protocol,
          container_port: policy.entry_port,
        }],
        environment: [],
        resources: {
          cpu_millicores: 500,
          memory_bytes: 256 * 1024 * 1024,
          ephemeral_storage_bytes: 512 * 1024 * 1024,
        },
        network: { egress: 'deny' },
        secret_envelope: null,
      },
    })
  }
  catch {
    throw new InstanceConfigurationInvalidError(policy)
  }
}

function destroyPayload(row: InstanceRow, context: CommandContextRow): DestroyInstanceJobPayload {
  return destroyInstanceJobPayloadSchema.parse({
    schema: instanceJobSchemaName,
    provider: row.provider,
    target: target(row, context),
    expires_at: null,
  })
}

function record(row: InstanceRow): InstanceRecord {
  return {
    id: row.id,
    contestId: row.contest_id,
    contestChallengeId: row.contest_challenge_id,
    participationId: row.participation_id,
    provider: row.provider,
    desiredState: row.desired_state,
    desiredGeneration: Number(row.desired_generation),
    observedState: row.observed_state,
    observedGeneration: Number(row.observed_generation),
    expiresAt: row.expires_at,
    entrypoints: instanceEntrypointSchema.array().parse(row.entrypoints).map(entrypoint => ({
      ...entrypoint,
      url: entrypoint.url ?? null,
    })),
    lastObservedAt: row.last_observed_at,
    lastErrorCode: row.last_error_code,
    lastErrorSummary: row.last_error_summary,
    version: Number(row.version),
  }
}
