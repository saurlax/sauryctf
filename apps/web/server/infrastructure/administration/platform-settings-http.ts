import type { H3Event } from 'h3'
import { getHeader, setResponseHeader } from 'h3'
import {
  managedPlatformSettingsResponseSchema,
  publicPlatformSettingsResponseSchema,
  updatePlatformSettingsRequestSchema,
  type ManagedPlatformSettings,
} from '../../../shared/contracts/platform-settings'
import { entityTagForVersion, requestIdSchema, versionFromIfMatch } from '../../../shared/contracts/http'
import { identityCapability } from '../../domains/identity/capabilities'
import type { PlatformSettingsRecord } from '../../domains/platform-settings/repository'
import {
  PlatformSettingsServiceError,
  type PlatformSettingsService,
} from '../../domains/platform-settings/service'
import {
  identityHttpDependencies,
  requireProtectedCapability,
  type IdentityHttpDependencies,
} from '../auth/identity-http'
import { safeDownloadPresentation } from '../../domains/content/download-service'
import { readValidatedJsonBody } from '../http/body'
import { createApiError } from '../http/errors'

type PlatformSettingsCommands = Pick<PlatformSettingsService,
  'readLogo' | 'readManaged' | 'readPublic' | 'update'>

export interface PlatformSettingsHttpDependencies {
  identity: IdentityHttpDependencies
  settings: PlatformSettingsCommands
}

export function platformSettingsHttpDependencies(event: H3Event): PlatformSettingsHttpDependencies {
  if (!event.context.services) {
    throw createApiError(503, 'platform.not_ready', '控制面平台设置服务尚未就绪')
  }
  return {
    identity: identityHttpDependencies(event),
    settings: event.context.services.platformSettings,
  }
}

export async function handlePublicPlatformSettings(
  event: H3Event,
  dependencies = platformSettingsHttpDependencies(event),
) {
  const settings = await runSettingsOperation(() => dependencies.settings.readPublic())
  setResponseHeader(event, 'etag', entityTagForVersion(settings.version))
  setResponseHeader(event, 'cache-control', 'public, max-age=60, must-revalidate')
  return publicPlatformSettingsResponseSchema.parse({ settings: projection(settings) })
}

export async function handleManagedPlatformSettings(
  event: H3Event,
  dependencies = platformSettingsHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.platformSettingsManage,
    dependencies.identity,
  )
  const settings = await runSettingsOperation(() => dependencies.settings.readManaged(context.subject))
  setResponseHeader(event, 'etag', entityTagForVersion(settings.version))
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return managedPlatformSettingsResponseSchema.parse({ settings: managedProjection(settings) })
}

export async function handleUpdatePlatformSettings(
  event: H3Event,
  dependencies = platformSettingsHttpDependencies(event),
) {
  const context = await requireProtectedCapability(
    event,
    identityCapability.platformSettingsManage,
    dependencies.identity,
  )
  const expectedVersion = versionFromIfMatch(getHeader(event, 'if-match'))
  if (expectedVersion === null) {
    throw createApiError(428, 'resource.precondition_required', '需要有效的 If-Match 资源版本', {
      if_match: ['请提交当前资源的强 ETag，例如 "3"'],
    })
  }
  const input = await readValidatedJsonBody(event, updatePlatformSettingsRequestSchema)
  const settings = await runSettingsOperation(() => dependencies.settings.update(context.subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    expectedVersion,
    reason: input.reason,
    brandName: input.brand_name,
    logoObjectId: input.logo_object_id,
    theme: input.theme,
    defaultLocale: input.default_locale,
    publicRegistrationEnabled: input.public_registration_enabled,
    authenticationMode: input.authentication_mode,
  }))
  setResponseHeader(event, 'etag', entityTagForVersion(settings.version))
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return managedPlatformSettingsResponseSchema.parse({ settings: managedProjection(settings) })
}

export async function handlePublicPlatformLogo(
  event: H3Event,
  dependencies = platformSettingsHttpDependencies(event),
) {
  const logo = await runSettingsOperation(() => dependencies.settings.readLogo())
  const presentation = safeDownloadPresentation(logo.mediaType, logo.filename)
  setResponseHeader(event, 'content-type', presentation.mediaType)
  setResponseHeader(event, 'content-length', logo.body.byteLength)
  setResponseHeader(event, 'content-disposition', presentation.contentDisposition)
  setResponseHeader(event, 'etag', `"${logo.sha256Hex}"`)
  setResponseHeader(event, 'cache-control', 'public, max-age=300, must-revalidate')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  return Buffer.from(logo.body)
}

function projection(record: PlatformSettingsRecord) {
  return {
    brand_name: record.brandName,
    logo_object_id: record.logoObjectId,
    logo_url: record.logoObjectId ? '/api/platform/logo' : null,
    theme: record.theme,
    default_locale: record.defaultLocale,
    public_registration_enabled: record.publicRegistrationEnabled,
    authentication_mode: record.authenticationMode,
    version: record.version,
  }
}

function managedProjection(record: PlatformSettingsRecord): ManagedPlatformSettings {
  return {
    ...projection(record),
    updated_by: record.updatedBy,
    updated_at: record.updatedAt.toISOString(),
  }
}

async function runSettingsOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (!(error instanceof PlatformSettingsServiceError)) throw error
    const statusCode = {
      'platform.logo_unavailable': 404,
      'platform.settings_not_found': 503,
      'resource.version_conflict': 409,
    }[error.code]
    throw createApiError(statusCode, error.code, error.message)
  }
}
