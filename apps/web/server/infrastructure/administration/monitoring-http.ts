import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import {
  monitoringListRequestSchema,
  monitoringListResponseSchema,
} from '../../../shared/contracts/monitoring'
import { identityCapability } from '../../domains/identity/capabilities'
import type { AdministrationMonitoringService } from '../../domains/administration/monitoring'
import {
  identityHttpDependencies,
  requireProtectedCapability,
  type IdentityHttpDependencies,
} from '../auth/identity-http'
import { createApiError } from '../http/errors'

export interface MonitoringHttpDependencies {
  identity: IdentityHttpDependencies
  monitoring: Pick<AdministrationMonitoringService, 'list'>
}

function dependencies(event: H3Event): MonitoringHttpDependencies {
  if (!event.context.services) throw createApiError(503, 'platform.not_ready', '控制面数据库服务尚未就绪')
  return {
    identity: identityHttpDependencies(event),
    monitoring: event.context.services.monitoring,
  }
}

export async function handleListMonitoring(
  event: H3Event,
  injected = dependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.globalOperationsManage,
    injected.identity,
  )
  const query = monitoringListRequestSchema.parse(getQuery(event))
  return monitoringListResponseSchema.parse(await injected.monitoring.list(context.subject, query))
}
