import type { ControlPlaneServices } from '../services'
import type { ControlPlaneTelemetry, RequestTelemetryContext } from '../infrastructure/telemetry/telemetry'

declare module 'h3' {
  interface H3EventContext {
    requestId?: string
    requestTelemetry?: RequestTelemetryContext
    services?: ControlPlaneServices
    telemetry?: ControlPlaneTelemetry
  }
}

export {}
