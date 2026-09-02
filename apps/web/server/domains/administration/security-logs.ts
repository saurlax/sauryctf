export type SecurityLogSeverity = 'info' | 'warn' | 'error'

export interface SecurityLogEventInput {
  eventType: string
  severity: SecurityLogSeverity
  requestId: string
  errorCode: string
  method: string
  route: string
  statusCode: number
  occurredAt: Date
}

export interface SecurityLogWriter {
  record(input: SecurityLogEventInput): Promise<void>
}

const persistedIdentitySecurityCodes = new Set([
  'identity.invalid_credentials',
  'identity.session_invalid',
  'identity.token_invalid',
  'identity.capability_forbidden',
  'identity.self_management_forbidden',
])

export function isSecurityLogErrorCode(code: string): boolean {
  return code.startsWith('security.') || persistedIdentitySecurityCodes.has(code)
}
