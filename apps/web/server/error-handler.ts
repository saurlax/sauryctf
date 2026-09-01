import type { NitroErrorHandler } from 'nitropack'
import { randomUUID } from 'node:crypto'
import { setResponseHeader, setResponseStatus } from 'h3'
import { normalizeApiError } from './infrastructure/http/errors'
import { structuredLog } from './infrastructure/telemetry/logging'

const handler: NitroErrorHandler = async (error, event) => {
  const requestId = event.context.requestId ?? randomUUID()
  const response = normalizeApiError(error, requestId)

  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-store')
  setResponseHeader(event, 'x-request-id', requestId)
  setResponseStatus(event, response.statusCode)

  if (response.body.error.code === 'identity.invalid_credentials') {
    event.context.telemetry?.recordLoginFailure(response.body.error.code)
  }
  const spanContext = event.context.requestTelemetry?.span.spanContext()

  console.error(structuredLog('error', 'request.failed', {
    request_id: requestId,
    trace_id: spanContext?.traceId,
    span_id: spanContext?.spanId,
    error_code: response.body.error.code,
    error_type: error.name,
  }))

  event.context.telemetry?.finishRequest(event)
  event.res.end(JSON.stringify(response.body))
}

export default handler
