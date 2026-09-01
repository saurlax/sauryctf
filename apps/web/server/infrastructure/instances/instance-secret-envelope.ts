import { createCipheriv, randomBytes } from 'node:crypto'
import { z } from 'zod'
import {
  instanceProviderSchema,
  instanceSecretEnvelopeSchema,
  type InstanceSecretEnvelope,
} from '../../../shared/contracts/instance-jobs'
import { resourceVersionSchema, uuidSchema } from '../../../shared/contracts/common-types'

const envelopeMagic = Buffer.from([0x53, 0x43, 0x54, 0x46, 0x01])
const keyMaterialSchema = z.string().regex(
  /^[A-Za-z0-9_-]{43}$/u,
  '实例敏感载荷密钥必须是未填充的 32 字节 base64url',
)

export const instanceSensitiveEnvironmentSchema = z.array(z.strictObject({
  name: z.string().min(10).max(128).regex(/^SAURYCTF_[A-Z0-9_]*$/u),
  value: z.string().min(1).refine(
    value => new TextEncoder().encode(value).byteLength <= 8_192 && !value.includes('\0'),
    '敏感环境变量必须包含 1-8192 个非 NUL UTF-8 字节',
  ),
})).min(1).max(32).superRefine((environment, context) => {
  const names = new Set<string>()
  for (const [index, variable] of environment.entries()) {
    if (names.has(variable.name)) {
      context.addIssue({ code: 'custom', path: [index, 'name'], message: '敏感环境变量名称必须唯一' })
    }
    names.add(variable.name)
  }
})

export const instanceSecretContextSchema = z.strictObject({
  platform_id: z.string().min(1).max(63).regex(/^[a-z0-9](?:[a-z0-9.-]{0,61}[a-z0-9])?$/u),
  provider: instanceProviderSchema,
  contest_id: uuidSchema,
  contest_challenge_id: uuidSchema,
  team_id: uuidSchema,
  instance_id: uuidSchema,
  generation: resourceVersionSchema,
})

export const instanceSecretKeyringSchema = z.strictObject({
  activeKeyId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  keys: z.record(
    z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
    keyMaterialSchema,
  ),
}).superRefine((keyring, context) => {
  if (!Object.hasOwn(keyring.keys, keyring.activeKeyId)) {
    context.addIssue({ code: 'custom', path: ['activeKeyId'], message: '活动实例密钥必须存在于密钥环中' })
  }
})

export type InstanceSensitiveEnvironment = z.infer<typeof instanceSensitiveEnvironmentSchema>
export type InstanceSecretContext = z.infer<typeof instanceSecretContextSchema>
export type InstanceSecretKeyring = z.infer<typeof instanceSecretKeyringSchema>

interface RandomSource {
  (size: number): Buffer
}

export function encryptInstanceSecrets(
  environmentInput: unknown,
  contextInput: unknown,
  keyringInput: unknown,
  randomSource: RandomSource = randomBytes,
): InstanceSecretEnvelope {
  const environment = instanceSensitiveEnvironmentSchema.parse(environmentInput)
  const context = instanceSecretContextSchema.parse(contextInput)
  const keyring = instanceSecretKeyringSchema.parse(keyringInput)
  const keyEncryptionKey = Buffer.from(keyring.keys[keyring.activeKeyId]!, 'base64url')
  const dataKey = requireRandomBytes(randomSource, 32)
  const wrapNonce = requireRandomBytes(randomSource, 12)
  const payloadNonce = requireRandomBytes(randomSource, 12)
  const plaintext = Buffer.from(JSON.stringify({
    schema: 'instance-runtime-secrets.v1',
    environment: environment.map(variable => ({
      name: variable.name,
      value_base64: Buffer.from(variable.value, 'utf8').toString('base64'),
    })),
  }), 'utf8')

  try {
    const wrappedDataKey = sealGCM(
      keyEncryptionKey,
      wrapNonce,
      dataKey,
      Buffer.from(`sauryctf/instance-secrets.v1/wrap/${keyring.activeKeyId}`, 'utf8'),
    )
    const ciphertext = sealGCM(dataKey, payloadNonce, plaintext, payloadAssociatedData(context))
    return instanceSecretEnvelopeSchema.parse({
      schema: 'instance-secrets.v1',
      key_id: keyring.activeKeyId,
      ciphertext_base64: Buffer.concat([
        envelopeMagic,
        wrapNonce,
        payloadNonce,
        wrappedDataKey,
        ciphertext,
      ]).toString('base64'),
    })
  }
  finally {
    dataKey.fill(0)
    plaintext.fill(0)
  }
}

function sealGCM(key: Buffer, nonce: Buffer, plaintext: Buffer, associatedData: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(associatedData)
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
}

function payloadAssociatedData(context: InstanceSecretContext): Buffer {
  return Buffer.from([
    'sauryctf/instance-secrets.v1/payload',
    context.platform_id,
    context.provider,
    context.contest_id,
    context.contest_challenge_id,
    context.team_id,
    context.instance_id,
    String(context.generation),
  ].join('\n'), 'utf8')
}

function requireRandomBytes(randomSource: RandomSource, size: number): Buffer {
  const value = randomSource(size)
  if (!Buffer.isBuffer(value) || value.length !== size) {
    throw new TypeError(`随机源必须返回 ${size} 字节`)
  }
  return value
}
