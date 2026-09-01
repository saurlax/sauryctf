const sensitiveKey = /(?:authorization|cookie|credential|password|secret|session|token|flag|answer)/iu

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    sensitiveKey.test(key) ? '[REDACTED]' : redactSensitive(child),
  ]))
}

export function structuredLog(
  level: 'info' | 'warn' | 'error',
  event: string,
  attributes: Record<string, unknown>,
): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...redactSensitive(attributes) as Record<string, unknown>,
  })
}
