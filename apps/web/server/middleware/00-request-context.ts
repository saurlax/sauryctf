import { randomUUID } from 'node:crypto'
import { getRequestHeader, setResponseHeader } from 'h3'
import { requestIdSchema } from '../../shared/contracts/http'
import { defaultMaximumJsonBodyBytes } from '../infrastructure/http/body'
import { createApiError } from '../infrastructure/http/errors'

const methodsWithBodies = new Set(['POST', 'PUT', 'PATCH'])

export default defineEventHandler((event) => {
  const incomingRequestId = getRequestHeader(event, 'x-request-id')
  const parsedRequestId = requestIdSchema.safeParse(incomingRequestId)
  const requestId = parsedRequestId.success ? parsedRequestId.data : randomUUID()

  event.context.requestId = requestId
  setResponseHeader(event, 'x-request-id', requestId)
  event.context.telemetry?.beginRequest(event)

  if (!methodsWithBodies.has(event.method)) return
  const contentLength = Number(getRequestHeader(event, 'content-length'))
  if (Number.isFinite(contentLength) && contentLength > defaultMaximumJsonBodyBytes) {
    throw createApiError(413, 'request.body_too_large', '请求体超过大小限制')
  }
})
