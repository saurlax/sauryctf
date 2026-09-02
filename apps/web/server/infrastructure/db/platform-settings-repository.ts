import {
  PlatformLogoUnavailableError,
  PlatformSettingsNotFoundError,
  PlatformSettingsVersionConflictError,
  isSupportedPlatformLogo,
  type PlatformSettingsRecord,
  type PlatformSettingsRepository,
  type UpdatePlatformSettingsCommand,
} from '../../domains/platform-settings/repository'
import type { DatabaseExecutor } from './executor'

interface SettingsRow {
  brand_name: string
  logo_object_id: string | null
  theme: 'system' | 'light' | 'dark'
  default_locale: 'zh-CN' | 'en'
  public_registration_enabled: boolean
  authentication_mode: 'password_only'
  version: string
  updated_by: string | null
  updated_at: Date
}

const projection = `
  brand_name, logo_object_id::text, theme::text, default_locale::text,
  public_registration_enabled, authentication_mode::text,
  version::text, updated_by::text, updated_at`

export class PostgresPlatformSettingsRepository implements PlatformSettingsRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async read(): Promise<PlatformSettingsRecord> {
    const result = await this.database.query<SettingsRow>(`
      SELECT ${projection} FROM platform_settings WHERE singleton = true`)
    if (!result.rows[0]) throw new PlatformSettingsNotFoundError()
    return record(result.rows[0])
  }

  async update(command: UpdatePlatformSettingsCommand): Promise<PlatformSettingsRecord> {
    return this.database.transaction(async (connection) => {
      const locked = await connection.query<SettingsRow>(`
        SELECT ${projection} FROM platform_settings
        WHERE singleton = true FOR UPDATE`)
      const currentRow = locked.rows[0]
      if (!currentRow) throw new PlatformSettingsNotFoundError()
      const current = record(currentRow)
      if (current.version !== command.expectedVersion) {
        throw new PlatformSettingsVersionConflictError()
      }
      const next: PlatformSettingsRecord = {
        brandName: command.brandName ?? current.brandName,
        logoObjectId: command.logoObjectId === undefined ? current.logoObjectId : command.logoObjectId,
        theme: command.theme ?? current.theme,
        defaultLocale: command.defaultLocale ?? current.defaultLocale,
        publicRegistrationEnabled: command.publicRegistrationEnabled ?? current.publicRegistrationEnabled,
        authenticationMode: command.authenticationMode ?? current.authenticationMode,
        version: current.version + 1,
        updatedBy: command.actorId,
        updatedAt: current.updatedAt,
      }
      if (next.logoObjectId) await assertLogoAvailable(connection, next.logoObjectId)
      const updated = await connection.query<SettingsRow>(`
        UPDATE platform_settings
        SET brand_name = $1, logo_object_id = $2, theme = $3,
            default_locale = $4, public_registration_enabled = $5,
            authentication_mode = $6, version = version + 1,
            updated_by = $7, updated_at = clock_timestamp()
        WHERE singleton = true AND version = $8
        RETURNING ${projection}`, [
        next.brandName,
        next.logoObjectId,
        next.theme,
        next.defaultLocale,
        next.publicRegistrationEnabled,
        next.authenticationMode,
        command.actorId,
        command.expectedVersion,
      ])
      if (!updated.rows[0]) throw new PlatformSettingsVersionConflictError()
      if (next.logoObjectId !== current.logoObjectId) {
        await connection.query(
          `DELETE FROM content_references
           WHERE reference_type = 'platform_logo' AND platform_setting_id = true`,
        )
        if (next.logoObjectId) {
          await connection.query(`
            INSERT INTO content_references
              (content_object_id, reference_type, platform_setting_id)
            VALUES ($1, 'platform_logo', true)`, [next.logoObjectId])
        }
      }
      await connection.query(`
        INSERT INTO audit_events
          (actor_user_id, action, target_type, target_id, reason,
           outcome, request_id, changes, metadata)
        VALUES ($1, 'platform.settings.updated', 'platform_settings', NULL, $2,
                'succeeded', $3, $4, '{}'::jsonb)`, [
        command.actorId,
        command.reason,
        command.requestId,
        {
          previous_version: current.version,
          version: current.version + 1,
          changed_fields: changedFields(current, next),
        },
      ])
      return record(updated.rows[0])
    })
  }
}

async function assertLogoAvailable(connection: DatabaseExecutor, objectId: string) {
  const result = await connection.query<{ media_type: string, size_bytes: string }>(`
    SELECT media_type, size_bytes::text FROM content_objects
    WHERE id = $1 AND status = 'committed' AND committed_at IS NOT NULL
    FOR KEY SHARE`, [objectId])
  const object = result.rows[0]
  if (!object || !isSupportedPlatformLogo(object.media_type) || Number(object.size_bytes) > 5 * 1024 * 1024) {
    throw new PlatformLogoUnavailableError()
  }
}

function record(row: SettingsRow): PlatformSettingsRecord {
  return {
    brandName: row.brand_name,
    logoObjectId: row.logo_object_id,
    theme: row.theme,
    defaultLocale: row.default_locale,
    publicRegistrationEnabled: row.public_registration_enabled,
    authenticationMode: row.authentication_mode,
    version: Number(row.version),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}

function changedFields(current: PlatformSettingsRecord, next: PlatformSettingsRecord) {
  const fields: Array<[string, unknown, unknown]> = [
    ['brand_name', current.brandName, next.brandName],
    ['logo_object_id', current.logoObjectId, next.logoObjectId],
    ['theme', current.theme, next.theme],
    ['default_locale', current.defaultLocale, next.defaultLocale],
    ['public_registration_enabled', current.publicRegistrationEnabled, next.publicRegistrationEnabled],
    ['authentication_mode', current.authenticationMode, next.authenticationMode],
  ]
  return fields.filter(([, before, after]) => before !== after).map(([name]) => name)
}
