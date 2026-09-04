import { createApiError } from '../infrastructure/http/errors'
import {
  assertCsrfProof,
  assertSameOrigin,
  enforceNetworkRateLimits,
  isUnsafeApiRequest,
} from '../infrastructure/security/request-security'

export default defineEventHandler(async (event) => {
  assertSameOrigin(event, useRuntimeConfig(event).public.siteUrl)
  assertCsrfProof(event)

  const rateLimits = event.context.services?.rateLimits
  if (!rateLimits && isUnsafeApiRequest(event)) {
    throw createApiError(503, 'platform.not_ready', '安全服务尚未就绪')
  }
  if (rateLimits) await enforceNetworkRateLimits(event, rateLimits)
})
