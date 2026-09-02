import { randomUUID } from 'node:crypto'
import {
  deploymentConfigFieldErrors,
  inspectDeploymentConfig,
  type DeploymentEnvironment,
} from '../../../shared/contracts/deployment-config'
import { inspectDataServicesConfig } from '../../infrastructure/config/data-services'

export interface ReadinessResult {
  statusCode: 200 | 503
  body: {
    status?: 'ready'
    component?: 'control-plane'
    error?: {
      code: 'platform.not_ready'
      message: string
      request_id: string
      fields: Record<string, string[]>
    }
  }
}

export interface ControlPlaneDependencyReadiness {
  ready(): Promise<void>
}

export async function evaluateControlPlaneReadiness(
  environment: DeploymentEnvironment,
  dependencies: ControlPlaneDependencyReadiness | undefined,
  requestId: string = randomUUID(),
): Promise<ReadinessResult> {
  const result = inspectDeploymentConfig(environment)
  const dataServices = inspectDataServicesConfig(environment)
  if (!result.success || !dataServices.success) {
    const fields = {
      ...(!result.success ? deploymentConfigFieldErrors(result.error) : {}),
      ...(!dataServices.success ? dataServices.error.fields : {}),
    }
    return {
      statusCode: 503,
      body: {
        error: {
          code: 'platform.not_ready',
          message: '控制面缺少必需的部署配置',
          request_id: requestId,
          fields,
        },
      },
    }
  }

  if (!dependencies) {
    return dependencyFailure(requestId)
  }
  try {
    await dependencies.ready()
  }
  catch {
    return dependencyFailure(requestId)
  }

  return {
    statusCode: 200,
    body: {
      status: 'ready',
      component: 'control-plane',
    },
  }
}

function dependencyFailure(requestId: string): ReadinessResult {
  return {
    statusCode: 503,
    body: {
      error: {
        code: 'platform.not_ready',
        message: '控制面权威数据库或迁移版本尚未就绪',
        request_id: requestId,
        fields: {
          dependencies: ['PostgreSQL 不可用或数据库迁移版本与当前发布不一致'],
        },
      },
    },
  }
}
