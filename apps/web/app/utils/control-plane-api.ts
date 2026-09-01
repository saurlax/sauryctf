import type { paths } from '~/types/control-plane-api'
import type { FetchOptions } from 'ofetch'

export type ControlPlaneMethod = 'get' | 'post' | 'patch' | 'put' | 'delete'

type Operation<P extends keyof paths, M extends ControlPlaneMethod> =
  paths[P] extends Record<M, infer Op> ? Op : never

type SuccessResponse<T> = T extends { responses: infer Responses }
  ? {
      [Status in keyof Responses]: Status extends 200 | 201 | 202 | 203 | 204
        ? Responses[Status] extends { content: { 'application/json': infer Body } }
          ? Body
          : never
        : never
    }[keyof Responses]
  : never

type RequestBody<T> = T extends { requestBody: { content: { 'application/json': infer Body } } }
  ? Body
  : never

type QueryParams<T> = T extends { parameters: { query?: infer Query } } ? Query : never
type PathParams<T> = T extends { parameters: { path: infer Path } } ? Path : never

export type ControlPlaneResponse<P extends keyof paths, M extends ControlPlaneMethod>
  = SuccessResponse<Operation<P, M>>

export type ControlPlaneOptions<P extends keyof paths, M extends ControlPlaneMethod>
  = Omit<FetchOptions, 'method' | 'body' | 'query'> & {
    body?: RequestBody<Operation<P, M>>
    query?: QueryParams<Operation<P, M>>
    params?: PathParams<Operation<P, M>>
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

export async function $controlApi<M extends ControlPlaneMethod, P extends keyof paths>(
  method: M,
  path: P,
  options?: ControlPlaneOptions<P, M>,
): Promise<ControlPlaneResponse<P, M>> {
  const resolvedPath = resolvePath(path, options?.params as Record<string, string | number> | undefined)
  const headers = new Headers(options?.headers)
  if (method !== 'get' && !csrfFreeWrites.has(path)) {
    headers.set('X-CSRF-Token', await csrfToken())
  }
  // The generated operation types narrow body/query per path; ofetch's generic
  // options cannot preserve that relationship after the path is resolved.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return $fetch(resolvedPath, {
    ...(options as any),
    body: options?.body as any,
    query: options?.query as any,
    params: undefined,
    headers,
    method: method.toUpperCase() as Uppercase<ControlPlaneMethod>,
    credentials: 'include',
  }) as Promise<ControlPlaneResponse<P, M>>
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
