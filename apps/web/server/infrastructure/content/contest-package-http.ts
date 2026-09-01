import type { H3Event } from 'h3'
import { getHeader, setResponseHeader, setResponseStatus } from 'h3'
import {
  contestPackageExportResponseSchema,
  contestPackageImportResponseSchema,
  createContestPackageExportRequestSchema,
  importContestPackageRequestSchema,
} from '../../../shared/contracts/contest-packages'
import { idempotencyKeySchema, requestIdSchema } from '../../../shared/contracts/http'
import { identityCapability } from '../../domains/identity/capabilities'
import {
  ContestPackageServiceError,
  type ContestPackageService,
} from '../../domains/contest-packages/service'
import {
  identityHttpDependencies,
  requireProtectedCapability,
  type IdentityHttpDependencies,
} from '../auth/identity-http'
import { readValidatedJsonBody } from '../http/body'
import { createApiError } from '../http/errors'

type ContestPackageCommands = Pick<ContestPackageService,
  'downloadExport' | 'exportContest' | 'importContest'>

export interface ContestPackageHttpDependencies {
  identity: IdentityHttpDependencies
  packages: ContestPackageCommands
}

export function contestPackageHttpDependencies(event: H3Event): ContestPackageHttpDependencies {
  if (!event.context.services) {
    throw createApiError(503, 'platform.not_ready', '控制面比赛包服务尚未就绪')
  }
  return {
    identity: identityHttpDependencies(event),
    packages: event.context.services.contestPackages,
  }
}

export async function handleCreateContestPackageExport(
  event: H3Event,
  contestId: string,
  dependencies = contestPackageHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contestManage,
    dependencies.identity,
  )
  const input = await readValidatedJsonBody(event, createContestPackageExportRequestSchema)
  const result = await runPackageOperation(() => dependencies.packages.exportContest(context.subject.userId, {
    requestId: requestIdSchema.parse(event.context.requestId),
    idempotencyKey: requiredIdempotencyKey(event),
    contestId,
    reason: input.reason,
  }))
  setResponseStatus(event, 201)
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return contestPackageExportResponseSchema.parse({ export: result })
}

export async function handleImportContestPackage(
  event: H3Event,
  dependencies = contestPackageHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.contestManage,
    dependencies.identity,
  )
  const input = await readValidatedJsonBody(event, importContestPackageRequestSchema)
  const result = await runPackageOperation(() => dependencies.packages.importContest(context.subject.userId, {
    requestId: requestIdSchema.parse(event.context.requestId),
    idempotencyKey: requiredIdempotencyKey(event),
    packageObjectId: input.package_object_id,
    inviteCode: input.invite_code,
    reason: input.reason,
  }))
  setResponseStatus(event, 201)
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return contestPackageImportResponseSchema.parse({ import: result })
}

export async function handleDownloadContestPackageExport(
  event: H3Event,
  exportId: string,
  dependencies = contestPackageHttpDependencies(event),
) {
  await requireProtectedCapability(
    event,
    identityCapability.contestManage,
    dependencies.identity,
  )
  const archive = await runPackageOperation(() => dependencies.packages.downloadExport(exportId))
  setResponseHeader(event, 'cache-control', 'private, no-store')
  setResponseHeader(event, 'content-type', archive.mediaType)
  setResponseHeader(event, 'content-disposition', `attachment; filename="${archive.filename}"`)
  setResponseHeader(event, 'content-length', archive.body.byteLength)
  return Buffer.from(archive.body)
}

function requiredIdempotencyKey(event: H3Event) {
  const parsed = idempotencyKeySchema.safeParse(getHeader(event, 'idempotency-key'))
  if (!parsed.success) {
    throw createApiError(428, 'request.idempotency_key_required', '需要有效的 Idempotency-Key', {
      idempotency_key: ['长度必须为 16 至 128，仅可使用字母、数字、点、下划线、冒号和连字符'],
    })
  }
  return parsed.data
}

async function runPackageOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (!(error instanceof ContestPackageServiceError)) throw error
    const statusCode = {
      'package.archive_invalid': 400,
      'package.compression_ratio_exceeded': 400,
      'package.contest_not_found': 404,
      'package.digest_mismatch': 400,
      'package.entry_limit_exceeded': 400,
      'package.export_not_found': 404,
      'package.file_set_invalid': 400,
      'package.idempotency_conflict': 409,
      'package.invite_code_required': 400,
      'package.manifest_invalid': 400,
      'package.object_unavailable': 404,
      'package.path_invalid': 400,
      'package.size_limit_exceeded': 413,
    }[error.code]
    throw createApiError(statusCode, error.code, error.message)
  }
}
