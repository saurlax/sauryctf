import type { H3Event } from 'h3'
import { readRawBody } from 'h3'
import type { ZodType } from 'zod'
import { createApiError } from './errors'

export const defaultMaximumJsonBodyBytes = 1024 * 1024

export function parseJsonText(
  text: string | undefined,
  maximumBytes = defaultMaximumJsonBodyBytes,
): unknown {
  if (text === undefined || text.length === 0) {
    throw createApiError(400, 'request.body_required', '请求体不能为空')
  }
  if (Buffer.byteLength(text, 'utf8') > maximumBytes) {
    throw createApiError(413, 'request.body_too_large', '请求体超过大小限制')
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw createApiError(400, 'request.malformed_json', '请求体不是有效 JSON')
  }
}

export async function readValidatedJsonBody<Output>(
  event: H3Event,
  schema: ZodType<Output>,
  maximumBytes = defaultMaximumJsonBodyBytes,
): Promise<Output> {
  const rawBody = await readRawBody(event)
  return schema.parse(parseJsonText(rawBody, maximumBytes))
}
