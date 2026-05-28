import type { AsyncDataOptions } from 'nuxt/app'
import type { HttpMethod, ApiResponse, ApiOptions } from '~/utils/api'
import type { paths } from '~/types/api'

export function useAPI<M extends HttpMethod, P extends keyof paths>(
  key: string,
  method: M,
  path: P,
  options?: ApiOptions<P, M>,
  asyncOptions?: AsyncDataOptions<ApiResponse<P, M>>,
) {
  return useAsyncData(key, () => $api(method, path, options), asyncOptions)
}
