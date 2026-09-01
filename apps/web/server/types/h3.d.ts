import type { ControlPlaneServices } from '../services'

declare module 'h3' {
  interface H3EventContext {
    requestId?: string
    services?: ControlPlaneServices
  }
}

export {}
