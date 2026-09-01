import { randomUUID } from 'node:crypto'
import {
  deploymentConfigFieldErrors,
  inspectDeploymentConfig,
  type DeploymentEnvironment,
} from '../../../shared/contracts/deployment-config'

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

export function evaluateControlPlaneReadiness(
  environment: DeploymentEnvironment,
  requestId = randomUUID(),
): ReadinessResult {
  const result = inspectDeploymentConfig(environment)
  if (!result.success) {
    return {
      statusCode: 503,
      body: {
        error: {
          code: 'platform.not_ready',
          message: '控制面缺少必需的部署配置',
          request_id: requestId,
          fields: deploymentConfigFieldErrors(result.error),
        },
      },
    }
  }

  return {
    statusCode: 200,
    body: {
      status: 'ready',
      component: 'control-plane',
    },
  }
}
