import type { H3Event } from 'h3'
import { setResponseHeader, setResponseStatus } from 'h3'
import { playerInstanceResponseSchema } from '../../../shared/contracts/instances'
import { entityTagForVersion, requestIdSchema } from '../../../shared/contracts/http'
import { identityCapability } from '../../domains/identity/capabilities'
import { InstanceServiceError, type InstanceService } from '../../domains/instances/service'
import {
  identityHttpDependencies,
  requireProtectedCapability,
  type IdentityHttpDependencies,
} from '../auth/identity-http'
import { createApiError } from '../http/errors'

type InstanceCommands = Pick<InstanceService, 'destroy' | 'read' | 'renew' | 'start'>

export interface InstanceHttpDependencies {
  identity: IdentityHttpDependencies
  instances: InstanceCommands
}

export function instanceHttpDependencies(event: H3Event): InstanceHttpDependencies {
  if (!event.context.services) {
    throw createApiError(503, 'platform.not_ready', '控制面数据库服务尚未就绪')
  }
  return {
    identity: identityHttpDependencies(event),
    instances: event.context.services.instances,
  }
}

export async function handleReadPlayerInstance(
  event: H3Event,
  contestId: string,
  challengeId: string,
  dependencies = instanceHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.instanceOperate,
    dependencies.identity,
  )
  const result = await runOperation(() => dependencies.instances.read(
    context.subject,
    contestId,
    challengeId,
  ))
  if (result.instance) setResponseHeader(event, 'etag', entityTagForVersion(result.instance.version))
  return playerInstanceResponseSchema.parse(result)
}

export async function handleStartPlayerInstance(
  event: H3Event,
  contestId: string,
  challengeId: string,
  dependencies = instanceHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.instanceOperate,
    dependencies.identity,
  )
  const result = await runInstanceCommand(event, 'start', contestId, challengeId, () => runOperation(
    () => dependencies.instances.start(context.subject, {
      requestId: requestIdSchema.parse(event.context.requestId),
      contestId,
      challengeId,
    }),
  ))
  setResponseStatus(event, 202)
  if (result.instance) setResponseHeader(event, 'etag', entityTagForVersion(result.instance.version))
  return playerInstanceResponseSchema.parse(result)
}

export async function handleRenewPlayerInstance(
  event: H3Event,
  contestId: string,
  challengeId: string,
  dependencies = instanceHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.instanceOperate,
    dependencies.identity,
  )
  const result = await runInstanceCommand(event, 'renew', contestId, challengeId, () => runOperation(
    () => dependencies.instances.renew(context.subject, {
      requestId: requestIdSchema.parse(event.context.requestId),
      contestId,
      challengeId,
    }),
  ))
  setResponseStatus(event, 202)
  if (result.instance) setResponseHeader(event, 'etag', entityTagForVersion(result.instance.version))
  return playerInstanceResponseSchema.parse(result)
}

export async function handleDestroyPlayerInstance(
  event: H3Event,
  contestId: string,
  challengeId: string,
  dependencies = instanceHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.instanceOperate,
    dependencies.identity,
  )
  const result = await runInstanceCommand(event, 'destroy', contestId, challengeId, () => runOperation(
    () => dependencies.instances.destroy(context.subject, {
      requestId: requestIdSchema.parse(event.context.requestId),
      contestId,
      challengeId,
    }),
  ))
  setResponseStatus(event, 202)
  if (result.instance) setResponseHeader(event, 'etag', entityTagForVersion(result.instance.version))
  return playerInstanceResponseSchema.parse(result)
}

async function runOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (!(error instanceof InstanceServiceError)) throw error
    const statusCode = {
      'instance.not_available': 404,
      'team.membership_required': 409,
      'participation.not_accepted': 403,
      'contest.instance_unavailable': 409,
      'challenge.instance_unavailable': 404,
      'instance.configuration_invalid': 409,
      'instance.quota_exceeded': 409,
      'instance.not_running': 409,
      'instance.renewal_too_early': 409,
    }[error.code]
    throw createApiError(statusCode, error.code, error.message, error.fields)
  }
}

async function runInstanceCommand<T>(
  event: H3Event,
  command: 'start' | 'renew' | 'destroy',
  contestId: string,
  challengeId: string,
  operation: () => Promise<T>,
) {
  const telemetry = event.context.telemetry
  try {
    const result = telemetry
      ? await telemetry.withSpan(event, `instance.${command}`, {
          'sauryctf.contest.id': contestId,
          'sauryctf.challenge.id': challengeId,
          'sauryctf.request.id': event.context.requestId ?? '',
        }, operation)
      : await operation()
    telemetry?.recordInstanceCommand(command, 'accepted')
    return result
  }
  catch (error) {
    telemetry?.recordInstanceCommand(command, 'rejected')
    throw error
  }
}
