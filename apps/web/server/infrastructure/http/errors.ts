import { createError, type H3Error } from 'h3'
import { ZodError } from 'zod'
import type { ApiError } from '../../../shared/contracts/http'

interface ApiErrorData {
  sauryctf: true
  code: string
  message: string
  fields: Record<string, string[]>
}

export interface NormalizedApiError {
  statusCode: number
  body: ApiError
}

export function createApiError(
  statusCode: number,
  code: string,
  message: string,
  fields: Record<string, string[]> = {},
): H3Error<ApiErrorData> {
  return createError<ApiErrorData>({
    statusCode,
    message,
    data: { sauryctf: true, code, message, fields },
  })
}

export function normalizeApiError(error: unknown, requestId: string): NormalizedApiError {
  const zodError = findZodError(error)
  if (zodError) {
    const fields: Record<string, string[]> = {}
    for (const issue of zodError.issues) {
      const path = issue.path.join('.') || 'request'
      fields[path] ??= []
      fields[path].push(issue.message)
    }
    return errorResponse(400, 'validation.failed', '请求字段无效', requestId, fields)
  }

  if (isSauryError(error)) {
    return errorResponse(
      error.statusCode,
      error.data.code,
      error.data.message,
      requestId,
      error.data.fields,
    )
  }

  return errorResponse(500, 'internal.unexpected', '服务器内部错误', requestId, {})
}

function findZodError(error: unknown): ZodError | undefined {
  if (error instanceof ZodError) return error
  if (typeof error !== 'object' || error === null || !('cause' in error)) return undefined
  return error.cause instanceof ZodError ? error.cause : undefined
}

function errorResponse(
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
  fields: Record<string, string[]>,
): NormalizedApiError {
  return {
    statusCode,
    body: {
      error: {
        code,
        message,
        request_id: requestId,
        fields,
      },
    },
  }
}

function isSauryError(error: unknown): error is H3Error<ApiErrorData> & { data: ApiErrorData } {
  if (!(error instanceof Error) || !('data' in error) || !('statusCode' in error)) return false
  const data = error.data as Partial<ApiErrorData> | undefined
  return data?.sauryctf === true
    && typeof data.code === 'string'
    && typeof data.message === 'string'
    && typeof data.fields === 'object'
}
