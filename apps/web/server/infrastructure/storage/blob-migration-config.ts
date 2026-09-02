import { resolve } from 'node:path'
import type { BlobBackendConfig } from './blob-storage'

export class BlobMigrationConfigurationError extends Error {
  constructor(readonly fields: string[]) {
    super(`Blob migration configuration is invalid: ${fields.join(', ')}`)
    this.name = 'BlobMigrationConfigurationError'
  }
}

export function parseBlobMigrationBackend(
  environment: NodeJS.ProcessEnv,
  side: 'SOURCE' | 'TARGET',
): BlobBackendConfig {
  const prefix = `BLOB_MIGRATION_${side}`
  const driverField = `${prefix}_DRIVER`
  const driver = normalized(environment[driverField])
  if (driver === 'fs') {
    const directoryField = `${prefix}_DIR`
    const directory = normalized(environment[directoryField])
    if (!directory) throw new BlobMigrationConfigurationError([directoryField])
    return { driver, directory: resolve(directory) }
  }
  if (driver === 's3') {
    const names = ['ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'BUCKET', 'REGION'] as const
    const values = Object.fromEntries(
      names.map(name => [name, normalized(environment[`${prefix}_S3_${name}`])]),
    ) as Record<(typeof names)[number], string | undefined>
    const missing = names.filter(name => !values[name]).map(name => `${prefix}_S3_${name}`)
    const endpoint = normalized(environment[`${prefix}_S3_ENDPOINT`])
    if (missing.length > 0) throw new BlobMigrationConfigurationError(missing)
    if (endpoint) {
      try { new URL(endpoint) }
      catch { throw new BlobMigrationConfigurationError([`${prefix}_S3_ENDPOINT`]) }
    }
    return {
      driver,
      accessKeyId: values.ACCESS_KEY_ID!,
      secretAccessKey: values.SECRET_ACCESS_KEY!,
      bucket: values.BUCKET!,
      region: values.REGION!,
      ...(endpoint ? { endpoint } : {}),
    }
  }
  throw new BlobMigrationConfigurationError([driverField])
}

function normalized(value: string | undefined) {
  return value?.trim() || undefined
}
