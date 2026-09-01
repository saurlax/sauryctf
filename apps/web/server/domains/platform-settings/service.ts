import type { ContentObjectService } from '../content/service'
import { ContentObjectServiceError } from '../content/service'
import { identityCapability, requireIdentityCapability } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'
import {
  PlatformLogoUnavailableError,
  PlatformSettingsNotFoundError,
  PlatformSettingsVersionConflictError,
  isSupportedPlatformLogo,
  type PlatformSettingsRecord,
  type PlatformSettingsRepository,
  type UpdatePlatformSettingsCommand,
} from './repository'

export type PlatformSettingsServiceErrorCode =
  | 'platform.logo_unavailable'
  | 'platform.settings_not_found'
  | 'resource.version_conflict'

export class PlatformSettingsServiceError extends Error {
  constructor(readonly code: PlatformSettingsServiceErrorCode, message: string) {
    super(message)
    this.name = 'PlatformSettingsServiceError'
  }
}

export class PlatformSettingsService {
  constructor(
    private readonly repository: PlatformSettingsRepository,
    private readonly content: Pick<ContentObjectService, 'readCommitted'>,
  ) {}

  readPublic(): Promise<PlatformSettingsRecord> {
    return this.run(() => this.repository.read())
  }

  async readManaged(actor: SessionSubject): Promise<PlatformSettingsRecord> {
    requireIdentityCapability(actor, identityCapability.platformSettingsManage)
    return this.run(() => this.repository.read())
  }

  async update(
    actor: SessionSubject,
    command: Omit<UpdatePlatformSettingsCommand, 'actorId'>,
  ): Promise<PlatformSettingsRecord> {
    requireIdentityCapability(actor, identityCapability.platformSettingsManage)
    return this.run(() => this.repository.update({ ...command, actorId: actor.userId }))
  }

  async readLogo(): Promise<{
    body: Uint8Array
    mediaType: string
    filename: string
    sha256Hex: string
  }> {
    const settings = await this.run(() => this.repository.read())
    if (!settings.logoObjectId) {
      throw new PlatformSettingsServiceError('platform.logo_unavailable', '平台尚未设置 Logo')
    }
    try {
      const result = await this.content.readCommitted(settings.logoObjectId)
      if (!isSupportedPlatformLogo(result.object.mediaType) || result.object.sizeBytes > 5 * 1024 * 1024) {
        throw new PlatformSettingsServiceError('platform.logo_unavailable', '平台 Logo 不可用')
      }
      return {
        body: result.body,
        mediaType: result.object.mediaType,
        filename: result.object.originalFilename,
        sha256Hex: result.object.sha256Hex,
      }
    }
    catch (error) {
      if (error instanceof PlatformSettingsServiceError) throw error
      if (error instanceof ContentObjectServiceError) {
        throw new PlatformSettingsServiceError('platform.logo_unavailable', '平台 Logo 不可用')
      }
      throw error
    }
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    }
    catch (error) {
      if (error instanceof PlatformSettingsNotFoundError) {
        throw new PlatformSettingsServiceError('platform.settings_not_found', '平台设置不存在')
      }
      if (error instanceof PlatformSettingsVersionConflictError) {
        throw new PlatformSettingsServiceError('resource.version_conflict', '资源版本冲突，请刷新后重试')
      }
      if (error instanceof PlatformLogoUnavailableError) {
        throw new PlatformSettingsServiceError('platform.logo_unavailable', 'Logo 内容对象不存在、未提交或格式不受支持')
      }
      throw error
    }
  }
}
