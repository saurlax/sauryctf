import type { H3Event } from 'h3'
import { getHeader, setResponseHeader, setResponseStatus } from 'h3'
import {
  executeOperationalCommandRequestSchema,
  executeOperationalCommandResponseSchema,
} from '../../../shared/contracts/operations'
import { idempotencyKeySchema, requestIdSchema } from '../../../shared/contracts/http'
import {
  AdministrationOperationsError,
  type AdministrationOperationsService,
} from '../../domains/administration/operations'
import { identityCapability } from '../../domains/identity/capabilities'
import {
  identityHttpDependencies,
  requireProtectedCapability,
  type IdentityHttpDependencies,
} from '../auth/identity-http'
import { readValidatedJsonBody } from '../http/body'
import { createApiError } from '../http/errors'

export interface OperationsHttpDependencies {
  identity: IdentityHttpDependencies
  operations: Pick<AdministrationOperationsService, 'execute'>
}

function dependencies(event: H3Event): OperationsHttpDependencies {
  if (!event.context.services) throw createApiError(503, 'platform.not_ready', '控制面运维服务尚未就绪')
  return {
    identity: identityHttpDependencies(event),
    operations: event.context.services.operations,
  }
}

export async function handleExecuteOperationalCommand(
  event: H3Event,
  injected = dependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.globalOperationsManage,
    injected.identity,
  )
  const input = await readValidatedJsonBody(event, executeOperationalCommandRequestSchema)
  const idempotencyKey = requiredIdempotencyKey(event)
  try {
    const command = await injected.operations.execute(context.subject, {
      requestId: requestIdSchema.parse(event.context.requestId),
      idempotencyKey,
      kind: input.kind,
      targetId: input.target_id,
      reason: input.reason,
    })
    setResponseStatus(event, command.replayed ? 200 : 201)
    setResponseHeader(event, 'cache-control', 'private, no-store')
    return executeOperationalCommandResponseSchema.parse({ command })
  }
  catch (error) {
    if (!(error instanceof AdministrationOperationsError)) throw error
    const statusCode = {
      'operations.idempotency_conflict': 409,
      'operations.command_in_progress': 409,
      'operations.command_failed': 409,
      'operations.target_not_found': 404,
      'operations.target_state_invalid': 409,
      'operations.cache_unavailable': 503,
      'operations.execution_failed': 500,
    }[error.code]
    throw createApiError(statusCode, error.code, error.message)
  }
}

function requiredIdempotencyKey(event: H3Event): string {
  const parsed = idempotencyKeySchema.safeParse(getHeader(event, 'idempotency-key'))
  if (!parsed.success) {
    throw createApiError(428, 'request.idempotency_key_required', '需要有效的 Idempotency-Key', {
      idempotency_key: ['长度必须为 16 至 128，仅可使用字母、数字、点、下划线、冒号和连字符'],
    })
  }
  return parsed.data
}
