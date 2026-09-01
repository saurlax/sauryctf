import type {
  AuthenticationMode,
  PlatformLocale,
  PlatformTheme,
} from '../../../shared/contracts/platform-settings'

export interface PlatformSettingsRecord {
  brandName: string
  logoObjectId: string | null
  theme: PlatformTheme
  defaultLocale: PlatformLocale
  publicRegistrationEnabled: boolean
  authenticationMode: AuthenticationMode
  version: number
  updatedBy: string | null
  updatedAt: Date
}

export interface UpdatePlatformSettingsCommand {
  actorId: string
  requestId: string
  expectedVersion: number
  reason: string
  brandName?: string
  logoObjectId?: string | null
  theme?: PlatformTheme
  defaultLocale?: PlatformLocale
  publicRegistrationEnabled?: boolean
  authenticationMode?: AuthenticationMode
}

export interface PlatformSettingsRepository {
  read(): Promise<PlatformSettingsRecord>
  update(command: UpdatePlatformSettingsCommand): Promise<PlatformSettingsRecord>
}

export class PlatformSettingsNotFoundError extends Error {}
export class PlatformSettingsVersionConflictError extends Error {}
export class PlatformLogoUnavailableError extends Error {}

export function isSupportedPlatformLogo(mediaType: string) {
  return new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']).has(mediaType)
}
