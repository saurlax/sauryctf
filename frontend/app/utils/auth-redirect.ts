export function isSafeAuthRedirect(input: unknown): input is string {
  return typeof input === 'string' && input.startsWith('/') && !input.startsWith('//')
}

export function resolveAuthRedirect(input: unknown, fallback: string): string {
  return isSafeAuthRedirect(input) ? input : fallback
}

export function resolveOptionalAuthRedirect(input: unknown): string {
  return isSafeAuthRedirect(input) ? input : ''
}

export function buildAuthEntryPath(basePath: '/login' | '/register', redirect: string): string {
  return `${basePath}?redirect=${encodeURIComponent(redirect)}`
}
