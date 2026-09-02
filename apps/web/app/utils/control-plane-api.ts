import type { FetchOptions } from 'ofetch'

export type ControlPlaneMethod = 'get' | 'post' | 'patch' | 'put' | 'delete'

export type ControlPlaneOptions<Body = unknown, Query = Record<string, unknown>, Params = Record<string, string | number>>
  = Omit<FetchOptions, 'method' | 'body' | 'query'> & {
    body?: Body
    query?: Query
    params?: Params
  }

const csrfFreeWrites = new Set<string>([
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/password/reset/request',
  '/api/auth/password/reset/confirm',
  '/api/auth/email/verification/confirm',
])

let csrfRequest: Promise<string> | null = null

async function csrfToken(): Promise<string> {
  if (!csrfRequest) {
    csrfRequest = $fetch<{ csrf_token: string }>('/api/auth/csrf', { credentials: 'include' })
      .then(response => response.csrf_token)
      .finally(() => { csrfRequest = null })
  }
  return csrfRequest
}

function resolvePath(path: string, params?: Record<string, string | number>): string {
  if (!params) return path
  return path.replaceAll(/\{([^}]+)\}/g, (_, key: string) => {
    const value = params[key]
    return value === undefined ? `{${key}}` : encodeURIComponent(String(value))
  })
}

export async function $controlApi<Response, Body = unknown, Query = Record<string, unknown>, Params = Record<string, string | number>>(
  method: ControlPlaneMethod,
  path: string,
  options?: ControlPlaneOptions<Body, Query, Params>,
): Promise<Response> {
  const resolvedPath = resolvePath(path, options?.params as Record<string, string | number> | undefined)
  const headers = new Headers(options?.headers)
  if (method !== 'get' && !csrfFreeWrites.has(path)) {
    headers.set('X-CSRF-Token', await csrfToken())
  }
  // Shared contract types are supplied by each caller; ofetch cannot preserve
  // those generics after path interpolation.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return $fetch(resolvedPath, {
    ...(options as any),
    body: options?.body as any,
    query: options?.query as any,
    params: undefined,
    headers,
    method: method.toUpperCase() as Uppercase<ControlPlaneMethod>,
    credentials: 'include',
  }) as Promise<Response>
}

export function controlPlaneErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      data?: { error?: { message?: unknown }, message?: unknown }
      message?: unknown
    }
    const message = candidate.data?.error?.message ?? candidate.data?.message ?? candidate.message
    if (typeof message === 'string' && message.length > 0) return message
  }
  return '请求失败，请稍后重试'
}
