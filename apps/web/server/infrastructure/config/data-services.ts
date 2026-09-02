import { resolve } from 'node:path'
import { z } from 'zod'
import type { DeploymentEnvironment } from '../../../shared/contracts/deployment-config'

const postgresUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol
  return protocol === 'postgres:' || protocol === 'postgresql:'
}, '必须是 PostgreSQL URL')

const requiredS3Fields = [
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_BUCKET',
  'S3_REGION',
] as const

const allS3Fields = [...requiredS3Fields, 'S3_ENDPOINT'] as const

export type DataServicesConfig = {
  database: {
    dialect: 'postgresql'
    url: string
  }
  controlPlaneReplicaCount: number
  blob: {
    driver: 'fs'
    directory: string
  } | {
    driver: 's3'
    accessKeyId: string
    secretAccessKey: string
    bucket: string
    region: string
    endpoint?: string
  }
}

export class DataServicesConfigurationError extends Error {
  readonly fields: Record<string, string[]>

  constructor(fields: Record<string, string[]>) {
    super(`数据服务配置无效：${Object.keys(fields).join(', ')}`)
    this.name = 'DataServicesConfigurationError'
    this.fields = fields
  }
}

export function parseDataServicesConfig(
  environment: DeploymentEnvironment,
  applicationRoot = defaultApplicationRoot(),
): DataServicesConfig {
  const fields: Record<string, string[]> = {}
  const databaseResult = postgresUrlSchema.safeParse(normalize(environment.DATABASE_URL))
  if (!databaseResult.success) fields.DATABASE_URL = ['缺少或无效的部署配置']

  const replicaCountValue = normalize(environment.CONTROL_PLANE_REPLICA_COUNT) ?? '1'
  const replicaCount = Number(replicaCountValue)
  if (!Number.isSafeInteger(replicaCount) || replicaCount < 1) {
    fields.CONTROL_PLANE_REPLICA_COUNT = ['必须是大于等于 1 的整数']
  }

  const s3 = Object.fromEntries(allS3Fields.map(field => [field, normalize(environment[field])])) as
    Record<(typeof allS3Fields)[number], string | undefined>
  const configuredS3Fields = allS3Fields.filter(field => s3[field] !== undefined)
  const missingRequiredS3Fields = requiredS3Fields.filter(field => s3[field] === undefined)

  if (configuredS3Fields.length > 0 && missingRequiredS3Fields.length > 0) {
    for (const field of missingRequiredS3Fields) fields[field] = ['S3 配置不完整']
  }

  if (s3.S3_ENDPOINT !== undefined) {
    const endpointResult = z.url().safeParse(s3.S3_ENDPOINT)
    if (!endpointResult.success) fields.S3_ENDPOINT = ['必须是有效 URL']
  }

  const blobDirectoryValue = normalize(environment.NUXTHUB_BLOB_DIR)
  if (blobDirectoryValue?.includes('\0')) {
    fields.NUXTHUB_BLOB_DIR = ['包含无效字符']
  }

  const usesFileSystem = configuredS3Fields.length === 0
  if (usesFileSystem && Number.isSafeInteger(replicaCount) && replicaCount > 1) {
    fields.CONTROL_PLANE_REPLICA_COUNT = ['本机 Blob 仅支持单个控制面副本；多副本必须使用 S3']
  }

  if (Object.keys(fields).length > 0 || !databaseResult.success) {
    throw new DataServicesConfigurationError(fields)
  }

  const base = blobDirectoryValue ?? '.data/blob'
  return {
    database: { dialect: 'postgresql', url: databaseResult.data },
    controlPlaneReplicaCount: replicaCount,
    blob: usesFileSystem
      ? { driver: 'fs', directory: resolve(applicationRoot, base) }
      : {
          driver: 's3',
          accessKeyId: s3.S3_ACCESS_KEY_ID!,
          secretAccessKey: s3.S3_SECRET_ACCESS_KEY!,
          bucket: s3.S3_BUCKET!,
          region: s3.S3_REGION!,
          ...(s3.S3_ENDPOINT ? { endpoint: s3.S3_ENDPOINT } : {}),
        },
  }
}

export function inspectDataServicesConfig(
  environment: DeploymentEnvironment,
  applicationRoot?: string,
): { success: true, data: DataServicesConfig } | { success: false, error: DataServicesConfigurationError } {
  try {
    return { success: true, data: parseDataServicesConfig(environment, applicationRoot) }
  }
  catch (error) {
    if (error instanceof DataServicesConfigurationError) return { success: false, error }
    throw error
  }
}

function normalize(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function defaultApplicationRoot(): string {
  const cwd = process.cwd()
  return cwd.endsWith('/apps/web') ? cwd : resolve(cwd, 'apps/web')
}
