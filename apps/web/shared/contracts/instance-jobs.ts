import { z } from 'zod'
import { resourceVersionSchema, utcTimestampSchema, uuidSchema } from './common-types'

export const instanceJobPayloadVersion = 1 as const
export const instanceJobSchemaName = 'instance-job.v1' as const

export const instanceJobOperationSchema = z.enum(['ensure', 'inspect', 'destroy', 'reconcile'])
export const instanceProviderSchema = z.enum(['docker', 'kubernetes'])

const idempotencyKeySchema = z.string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)

export const instanceJobTargetSchema = z.strictObject({
  contest_id: uuidSchema,
  contest_challenge_id: uuidSchema,
  participation_id: uuidSchema,
  team_id: uuidSchema,
})

export const instanceEntrypointSpecSchema = z.strictObject({
  name: z.string().min(1).max(32).regex(/^[a-z][a-z0-9-]*$/u),
  protocol: z.enum(['http', 'tcp']),
  container_port: z.number().int().min(1).max(65_535),
})

export const instanceEnvironmentVariableSchema = z.strictObject({
  name: z.string().min(1).max(128).regex(/^[A-Z_][A-Z0-9_]*$/u),
  value: z.string().refine(
    value => new TextEncoder().encode(value).byteLength <= 8_192,
    '环境变量值不得超过 8192 UTF-8 字节',
  ),
})

export const instanceResourceLimitsSchema = z.strictObject({
  cpu_millicores: z.number().int().min(10).max(64_000),
  memory_bytes: z.number().int().min(16 * 1_024 * 1_024).max(512 * 1_024 * 1_024 * 1_024),
  ephemeral_storage_bytes: z.number().int().min(16 * 1_024 * 1_024).max(1_024 * 1_024 * 1_024 * 1_024),
})

export const instanceNetworkPolicySchema = z.strictObject({
  egress: z.enum(['deny', 'internet']),
})

export const instanceSecretEnvelopeSchema = z.strictObject({
  schema: z.literal('instance-secrets.v1'),
  key_id: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  ciphertext_base64: z.string()
    .min(4)
    .max(65_536)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
})

export const instanceRuntimeSpecSchema = z.strictObject({
  image: z.string().min(1).max(512).regex(/^[A-Za-z0-9][A-Za-z0-9._/:@+-]*$/u),
  entrypoints: z.array(instanceEntrypointSpecSchema).min(1).max(16),
  environment: z.array(instanceEnvironmentVariableSchema).max(100),
  resources: instanceResourceLimitsSchema,
  network: instanceNetworkPolicySchema,
  secret_envelope: instanceSecretEnvelopeSchema.nullable(),
}).superRefine((spec, context) => {
  const entrypointNames = new Set<string>()
  const entrypointSockets = new Set<string>()
  for (const [index, entrypoint] of spec.entrypoints.entries()) {
    const socket = `${entrypoint.protocol}:${entrypoint.container_port}`
    if (entrypointNames.has(entrypoint.name)) {
      context.addIssue({ code: 'custom', path: ['entrypoints', index, 'name'], message: '入口名称必须唯一' })
    }
    if (entrypointSockets.has(socket)) {
      context.addIssue({ code: 'custom', path: ['entrypoints', index, 'container_port'], message: '入口协议和容器端口组合必须唯一' })
    }
    entrypointNames.add(entrypoint.name)
    entrypointSockets.add(socket)
  }

  const environmentNames = new Set<string>()
  for (const [index, variable] of spec.environment.entries()) {
    if (variable.name.startsWith('SAURYCTF_')) {
      context.addIssue({ code: 'custom', path: ['environment', index, 'name'], message: '平台保留环境变量不能由题目覆盖' })
    }
    if (environmentNames.has(variable.name)) {
      context.addIssue({ code: 'custom', path: ['environment', index, 'name'], message: '环境变量名称必须唯一' })
    }
    environmentNames.add(variable.name)
  }
})

const instancePayloadBaseShape = {
  schema: z.literal(instanceJobSchemaName),
  provider: instanceProviderSchema,
  target: instanceJobTargetSchema,
  expires_at: utcTimestampSchema.nullable(),
} as const

export const ensureInstanceJobPayloadSchema = z.strictObject({
  ...instancePayloadBaseShape,
  spec: instanceRuntimeSpecSchema,
})

export const inspectInstanceJobPayloadSchema = z.strictObject(instancePayloadBaseShape)
export const destroyInstanceJobPayloadSchema = z.strictObject(instancePayloadBaseShape)

export const reconcileInstanceJobPayloadSchema = z.strictObject({
  ...instancePayloadBaseShape,
  desired_state: z.enum(['running', 'stopped']),
  spec: instanceRuntimeSpecSchema.nullable(),
}).superRefine((payload, context) => {
  if (payload.desired_state === 'running' && payload.spec === null) {
    context.addIssue({ code: 'custom', path: ['spec'], message: '运行态对账必须携带运行规格' })
  }
  if (payload.desired_state === 'stopped' && payload.spec !== null) {
    context.addIssue({ code: 'custom', path: ['spec'], message: '停止态对账不得携带运行规格' })
  }
})

const instanceJobEnvelopeShape = {
  job_id: uuidSchema,
  instance_id: uuidSchema,
  payload_version: z.literal(instanceJobPayloadVersion),
  desired_generation: resourceVersionSchema,
  idempotency_key: idempotencyKeySchema,
} as const

export const ensureInstanceJobSchema = z.strictObject({
  ...instanceJobEnvelopeShape,
  operation: z.literal('ensure'),
  payload: ensureInstanceJobPayloadSchema,
})

export const inspectInstanceJobSchema = z.strictObject({
  ...instanceJobEnvelopeShape,
  operation: z.literal('inspect'),
  payload: inspectInstanceJobPayloadSchema,
})

export const destroyInstanceJobSchema = z.strictObject({
  ...instanceJobEnvelopeShape,
  operation: z.literal('destroy'),
  payload: destroyInstanceJobPayloadSchema,
})

export const reconcileInstanceJobSchema = z.strictObject({
  ...instanceJobEnvelopeShape,
  operation: z.literal('reconcile'),
  payload: reconcileInstanceJobPayloadSchema,
})

export const instanceJobSchema = z.discriminatedUnion('operation', [
  ensureInstanceJobSchema,
  inspectInstanceJobSchema,
  destroyInstanceJobSchema,
  reconcileInstanceJobSchema,
])

export type InstanceJobOperation = z.infer<typeof instanceJobOperationSchema>
export type InstanceProvider = z.infer<typeof instanceProviderSchema>
export type InstanceRuntimeSpec = z.infer<typeof instanceRuntimeSpecSchema>
export type EnsureInstanceJobPayload = z.infer<typeof ensureInstanceJobPayloadSchema>
export type InspectInstanceJobPayload = z.infer<typeof inspectInstanceJobPayloadSchema>
export type DestroyInstanceJobPayload = z.infer<typeof destroyInstanceJobPayloadSchema>
export type ReconcileInstanceJobPayload = z.infer<typeof reconcileInstanceJobPayloadSchema>
export type InstanceJob = z.infer<typeof instanceJobSchema>
