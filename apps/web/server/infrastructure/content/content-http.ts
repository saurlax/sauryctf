import type { H3Event } from 'h3'
import { getHeader, setResponseHeader, setResponseStatus } from 'h3'
import {
  commitContentUploadRequestSchema,
  contentDownloadResponseSchema,
  contentObjectResponseSchema,
} from '../../../shared/contracts/content'
import { uuidSchema } from '../../../shared/contracts/common-types'
import {
  ContentDownloadServiceError,
  type ContentDownloadService,
} from '../../domains/content/download-service'
import {
  ContentObjectServiceError,
  maximumContentObjectBytes,
  type ContentObject,
  type ContentObjectService,
} from '../../domains/content/service'
import { identityCapability } from '../../domains/identity/capabilities'
import {
  identityHttpDependencies,
  requireProtectedCapability,
  type IdentityHttpDependencies,
} from '../auth/identity-http'
import { readValidatedJsonBody } from '../http/body'
import { createApiError } from '../http/errors'

type ContentCommands = Pick<ContentObjectService, 'uploadTemporary' | 'commitTemporary'>
type ContentDownloadCommands = Pick<ContentDownloadService, 'challengeAsset' | 'writeupAttachment'>

export interface ContentHttpDependencies {
  identity: IdentityHttpDependencies
  content: ContentCommands
  readUpload(event: H3Event): Promise<Uint8Array>
}

export interface ContentDownloadHttpDependencies {
  identity: IdentityHttpDependencies
  downloads: ContentDownloadCommands
}

export function contentHttpDependencies(event: H3Event): ContentHttpDependencies {
  if (!event.context.services) {
    throw createApiError(503, 'platform.not_ready', '控制面内容服务尚未就绪')
  }
  return {
    identity: identityHttpDependencies(event),
    content: event.context.services.content,
    readUpload: readLimitedUpload,
  }
}

export function contentDownloadHttpDependencies(event: H3Event): ContentDownloadHttpDependencies {
  if (!event.context.services) {
    throw createApiError(503, 'platform.not_ready', '控制面内容服务尚未就绪')
  }
  return {
    identity: identityHttpDependencies(event),
    downloads: event.context.services.contentDownloads,
  }
}

export async function handleCreateContentUpload(
  event: H3Event,
  dependencies = contentHttpDependencies(event),
) {
  const context = await requireProtectedCapability(event, identityCapability.writeupWrite, dependencies.identity)
  const filenameHeader = getHeader(event, 'x-content-filename')
  if (!filenameHeader) {
    throw createApiError(400, 'content.filename_required', '需要 X-Content-Filename 请求头')
  }
  let originalFilename: string
  try {
    originalFilename = decodeURIComponent(filenameHeader)
  }
  catch {
    throw createApiError(400, 'content.filename_invalid', '文件名编码无效')
  }
  const mediaType = getHeader(event, 'content-type') ?? 'application/octet-stream'
  const body = await dependencies.readUpload(event)
  const content = await runContentOperation(() => dependencies.content.uploadTemporary(
    context.subject.userId,
    {
      body,
      originalFilename,
      mediaType,
    },
  ))
  setResponseStatus(event, content.status === 'committed' ? 200 : 201)
  return response(content)
}

export async function handleCommitContentUpload(
  event: H3Event,
  objectId: string,
  dependencies = contentHttpDependencies(event),
) {
  const context = await requireProtectedCapability(event, identityCapability.writeupWrite, dependencies.identity)
  const input = await readValidatedJsonBody(event, commitContentUploadRequestSchema)
  return response(await runContentOperation(() => dependencies.content.commitTemporary(
    context.subject.userId,
    objectId,
    input.sha256,
  )))
}

export async function handleChallengeAssetDownload(
  event: H3Event,
  assetId: string,
  dependencies = contentDownloadHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contentDownload,
    dependencies.identity,
  )
  return downloadResponse(event, await runContentDownload(() => (
    dependencies.downloads.challengeAsset(context.subject, pathId(assetId))
  )))
}

export async function handleWriteupAttachmentDownload(
  event: H3Event,
  referenceId: string,
  dependencies = contentDownloadHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contentDownload,
    dependencies.identity,
  )
  return downloadResponse(event, await runContentDownload(() => (
    dependencies.downloads.writeupAttachment(context.subject, pathId(referenceId))
  )))
}

export async function readLimitedUpload(event: H3Event): Promise<Uint8Array> {
  const declaredLength = getHeader(event, 'content-length')
  if (declaredLength) {
    const parsed = Number(declaredLength)
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw createApiError(400, 'request.content_length_invalid', 'Content-Length 无效')
    }
    if (parsed > maximumContentObjectBytes) {
      throw createApiError(413, 'content.upload_too_large', '上传内容超过 64 MiB 限制')
    }
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of event.node.req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > maximumContentObjectBytes) {
      throw createApiError(413, 'content.upload_too_large', '上传内容超过 64 MiB 限制')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks, total)
}

async function runContentOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (!(error instanceof ContentObjectServiceError)) throw error
    const statusCode = {
      'content.digest_invalid': 400,
      'content.digest_mismatch': 409,
      'content.filename_invalid': 400,
      'content.media_type_invalid': 400,
      'content.object_not_found': 404,
      'content.object_not_temporary': 409,
      'content.storage_mismatch': 409,
      'content.upload_conflict': 409,
      'content.upload_empty': 400,
      'content.upload_too_large': 413,
    }[error.code]
    throw createApiError(statusCode, error.code, error.message)
  }
}

async function runContentDownload<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (!(error instanceof ContentDownloadServiceError)) throw error
    throw createApiError(404, error.code, error.message)
  }
}

function pathId(value: string): string {
  const parsed = uuidSchema.safeParse(value)
  if (!parsed.success) {
    throw createApiError(400, 'validation.failed', '路径参数无效', {
      id: ['必须是有效 UUID'],
    })
  }
  return parsed.data
}

function downloadResponse(event: H3Event, grant: Awaited<ReturnType<ContentDownloadService['challengeAsset']>>) {
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return contentDownloadResponseSchema.parse({
    url: grant.url,
    expires_at: grant.expiresAt.toISOString(),
    disposition: grant.disposition,
    filename: grant.filename,
    media_type: grant.mediaType,
  })
}

function response(content: ContentObject) {
  return contentObjectResponseSchema.parse({
    id: content.id,
    sha256: content.sha256Hex,
    size_bytes: content.sizeBytes,
    media_type: content.mediaType,
    original_filename: content.originalFilename,
    status: content.status,
    committed_at: content.committedAt?.toISOString() ?? null,
    created_at: content.createdAt.toISOString(),
  })
}
