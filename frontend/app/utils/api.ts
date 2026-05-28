import type { paths } from '~/types/api'
import type { FetchOptions } from 'ofetch'

export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch'

type SuccessResponse<T> = T extends { responses: infer R }
  ? {
      [K in keyof R]: K extends 200 | 201 | 202 | 203 | 204
        ? R[K] extends { content: { 'application/json': infer Body } }
          ? Body
          : never
        : never
    }[keyof R]
  : never

type RequestBody<T> = T extends {
  requestBody: { content: { 'application/json': infer Body } }
}
  ? Body
  : never

type QueryParams<T> = T extends { parameters: { query?: infer Q } }
  ? Q
  : never

type Operation<P extends keyof paths, M extends HttpMethod> =
  paths[P] extends Record<M, infer Op> ? Op : never

export type ApiResponse<P extends keyof paths, M extends HttpMethod> = SuccessResponse<Operation<P, M>>
export type ApiBody<P extends keyof paths, M extends HttpMethod> = RequestBody<Operation<P, M>>
export type ApiQuery<P extends keyof paths, M extends HttpMethod> = QueryParams<Operation<P, M>>

export type ApiOptions<P extends keyof paths, M extends HttpMethod> =
  Omit<FetchOptions, 'method' | 'body' | 'query'> & {
    body?: ApiBody<P, M>
    query?: ApiQuery<P, M>
  }

export function $api<M extends HttpMethod, P extends keyof paths>(
  method: M,
  path: P,
  options?: ApiOptions<P, M>,
): Promise<ApiResponse<P, M>> {
  const { $apiFetch } = useNuxtApp()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return $apiFetch(path as string, { ...(options as any), method: method.toUpperCase() }) as Promise<ApiResponse<P, M>>
}
