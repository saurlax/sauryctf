import { z } from 'zod'

const postgresUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol
  return protocol === 'postgres:' || protocol === 'postgresql:'
}, '必须是 PostgreSQL URL')

const redisUrlSchema = z.url().refine(
  (value) => ['redis:', 'rediss:'].includes(new URL(value).protocol),
  '必须是 Redis URL',
)

const publicOriginSchema = z.url().refine((value) => {
  const url = new URL(value)
  return (url.protocol === 'http:' || url.protocol === 'https:')
    && url.origin === value.replace(/\/$/u, '')
}, '必须是没有路径的 HTTP(S) Origin')

const booleanFromEnvironmentSchema = z.preprocess((value) => {
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}, z.boolean())

export const deploymentConfigSchema = z.strictObject({
  databaseUrl: postgresUrlSchema,
  redisUrl: redisUrlSchema,
  publicOrigin: publicOriginSchema,
  sessionPassword: z.string().min(32).max(1024),
  objectStorage: z.strictObject({
    endpoint: z.url(),
    region: z.string().min(1).max(100),
    bucket: z.string().min(3).max(63),
    accessKeyId: z.string().min(1).max(512),
    secretAccessKey: z.string().min(1).max(1024),
    forcePathStyle: booleanFromEnvironmentSchema,
  }),
})

export type DeploymentConfig = z.infer<typeof deploymentConfigSchema>

export type DeploymentEnvironment = Record<string, string | undefined>

export function deploymentConfigInput(environment: DeploymentEnvironment) {
  return {
    databaseUrl: environment.DATABASE_URL,
    redisUrl: environment.REDIS_URL,
    publicOrigin: environment.PUBLIC_ORIGIN,
    sessionPassword: environment.NUXT_SESSION_PASSWORD,
    objectStorage: {
      endpoint: environment.S3_ENDPOINT,
      region: environment.S3_REGION,
      bucket: environment.S3_BUCKET,
      accessKeyId: environment.S3_ACCESS_KEY_ID,
      secretAccessKey: environment.S3_SECRET_ACCESS_KEY,
      forcePathStyle: environment.S3_FORCE_PATH_STYLE,
    },
  }
}

export function parseDeploymentConfig(environment: DeploymentEnvironment): DeploymentConfig {
  return deploymentConfigSchema.parse(deploymentConfigInput(environment))
}

export function inspectDeploymentConfig(environment: DeploymentEnvironment) {
  return deploymentConfigSchema.safeParse(deploymentConfigInput(environment))
}

export function deploymentConfigFieldErrors(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {}

  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'configuration'
    fields[path] ??= []
    fields[path].push('缺少或无效的部署配置')
  }

  return fields
}
