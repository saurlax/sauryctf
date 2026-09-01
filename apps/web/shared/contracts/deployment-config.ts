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

const optionalEnvironmentValueSchema = z.preprocess(
  value => value === '' ? undefined : value,
  z.string().min(1).max(2048).optional(),
)

const instanceSecretKeyIdSchema = z.string().min(1).max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)

const instanceSecretKeysSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  }
  catch {
    return value
  }
}, z.record(
  instanceSecretKeyIdSchema,
  z.string().regex(/^[A-Za-z0-9_-]{43}$/u, '必须是未填充的 32 字节 base64url 密钥'),
).refine(keys => Object.keys(keys).length > 0, '实例敏感载荷密钥环不能为空'))

export const deploymentConfigSchema = z.strictObject({
  databaseUrl: postgresUrlSchema,
  redisUrl: redisUrlSchema,
  publicOrigin: publicOriginSchema,
  sessionPassword: z.string().min(32).max(1024),
  submissionAnswerKey: z.string().regex(
    /^[A-Za-z0-9_-]{43}$/u,
    '必须是未填充的 32 字节 base64url 密钥',
  ),
  instanceSecrets: z.strictObject({
    activeKeyId: instanceSecretKeyIdSchema,
    keys: instanceSecretKeysSchema,
  }),
  objectStorage: z.strictObject({
    endpoint: z.url(),
    region: z.string().min(1).max(100),
    bucket: z.string().min(3).max(63),
    accessKeyId: z.string().min(1).max(512),
    secretAccessKey: z.string().min(1).max(1024),
    forcePathStyle: booleanFromEnvironmentSchema,
  }),
  turnstile: z.strictObject({
    secretKey: optionalEnvironmentValueSchema,
    siteKey: optionalEnvironmentValueSchema,
  }),
}).superRefine((config, context) => {
  if (!Object.hasOwn(config.instanceSecrets.keys, config.instanceSecrets.activeKeyId)) {
    context.addIssue({
      code: 'custom',
      path: ['instanceSecrets', 'activeKeyId'],
      message: '活动实例敏感载荷密钥必须存在于密钥环中',
    })
  }
  if (Boolean(config.turnstile.secretKey) === Boolean(config.turnstile.siteKey)) return
  context.addIssue({
    code: 'custom',
    path: ['turnstile'],
    message: 'Turnstile 站点密钥与服务端密钥必须同时配置',
  })
})

export type DeploymentConfig = z.infer<typeof deploymentConfigSchema>

export type DeploymentEnvironment = Record<string, string | undefined>

export function deploymentConfigInput(environment: DeploymentEnvironment) {
  return {
    databaseUrl: environment.DATABASE_URL,
    redisUrl: environment.REDIS_URL,
    publicOrigin: environment.PUBLIC_ORIGIN,
    sessionPassword: environment.NUXT_SESSION_PASSWORD,
    submissionAnswerKey: environment.SUBMISSION_ANSWER_KEY,
    instanceSecrets: {
      activeKeyId: environment.INSTANCE_SECRET_ACTIVE_KEY_ID,
      keys: environment.INSTANCE_SECRET_KEYS,
    },
    objectStorage: {
      endpoint: environment.S3_ENDPOINT,
      region: environment.S3_REGION,
      bucket: environment.S3_BUCKET,
      accessKeyId: environment.S3_ACCESS_KEY_ID,
      secretAccessKey: environment.S3_SECRET_ACCESS_KEY,
      forcePathStyle: environment.S3_FORCE_PATH_STYLE,
    },
    turnstile: {
      secretKey: environment.TURNSTILE_SECRET_KEY,
      siteKey: environment.TURNSTILE_SITE_KEY,
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
