import { createDecipheriv } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { encryptInstanceSecrets } from './instance-secret-envelope'

const context = {
  platform_id: 'sauryctf',
  provider: 'docker',
  contest_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451021',
  contest_challenge_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451031',
  team_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451051',
  instance_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451011',
  generation: 4,
} as const

const keyring = {
  activeKeyId: 'worker-key-v1',
  keys: {
    'worker-key-v1': 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY',
  },
}

describe('instance secret envelope encryption', () => {
  it('uses a random data key wrapped by the active AES key', async () => {
    const envelope = encryptInstanceSecrets(
      [{ name: 'SAURYCTF_FLAG', value: 'flag{encrypted-for-worker}' }],
      context,
      keyring,
      deterministicRandomSource(),
    )
    expect(envelope.schema).toBe('instance-secrets.v1')
    expect(envelope.key_id).toBe('worker-key-v1')
    const fixture = JSON.parse(await readFile(
      new URL('../../../../../contracts/fixtures/instance-jobs/v1/ensure.json', import.meta.url),
      'utf8',
    )) as { payload: { spec: { secret_envelope: unknown } } }
    expect(envelope).toEqual(fixture.payload.spec.secret_envelope)
    expect(JSON.stringify(envelope)).not.toContain('flag{encrypted-for-worker}')
    expect(openEnvelope(envelope.ciphertext_base64, context)).toEqual({
      schema: 'instance-runtime-secrets.v1',
      environment: [{ name: 'SAURYCTF_FLAG', value_base64: 'ZmxhZ3tlbmNyeXB0ZWQtZm9yLXdvcmtlcn0=' }],
    })
  })

  it('binds ciphertext to the instance generation and rejects unsafe variables', () => {
    const envelope = encryptInstanceSecrets(
      [{ name: 'SAURYCTF_FLAG', value: 'flag{bound}' }],
      context,
      keyring,
      deterministicRandomSource(),
    )
    expect(() => openEnvelope(envelope.ciphertext_base64, { ...context, generation: 8 })).toThrow()
    expect(() => encryptInstanceSecrets([{ name: 'FLAG', value: 'flag{plain}' }], context, keyring)).toThrow()
    expect(() => encryptInstanceSecrets([
      { name: 'SAURYCTF_FLAG', value: 'one' },
      { name: 'SAURYCTF_FLAG', value: 'two' },
    ], context, keyring)).toThrow()
  })

  it('keeps the Flag out of an ordinary serialized job view', () => {
    const secretEnvelope = encryptInstanceSecrets(
      [{ name: 'SAURYCTF_FLAG', value: 'flag{not-in-task-json}' }],
      context,
      keyring,
      deterministicRandomSource(),
    )
    const ordinaryJob = JSON.stringify({
      operation: 'ensure',
      payload: { spec: { secret_envelope: secretEnvelope } },
    })
    expect(ordinaryJob).not.toContain('flag{not-in-task-json}')
    expect(ordinaryJob).not.toContain('SAURYCTF_FLAG')
  })
})

function deterministicRandomSource() {
  const values = [
    Buffer.from('abcdef0123456789abcdef0123456789'),
    Buffer.from('wrap-nonce01'),
    Buffer.from('data-nonce01'),
  ]
  return (size: number) => {
    const value = values.shift()
    if (!value || value.length !== size) throw new Error(`unexpected random request: ${size}`)
    return value
  }
}

function openEnvelope(ciphertextBase64: string, targetContext: typeof context | { generation: number }) {
  const blob = Buffer.from(ciphertextBase64, 'base64')
  expect(blob.subarray(0, 5)).toEqual(Buffer.from([0x53, 0x43, 0x54, 0x46, 0x01]))
  const wrapNonce = blob.subarray(5, 17)
  const payloadNonce = blob.subarray(17, 29)
  const wrappedDataKey = blob.subarray(29, 77)
  const payloadCiphertext = blob.subarray(77)
  const keyEncryptionKey = Buffer.from(keyring.keys['worker-key-v1'], 'base64url')
  const dataKey = openGCM(
    keyEncryptionKey,
    wrapNonce,
    wrappedDataKey,
    Buffer.from('sauryctf/instance-secrets.v1/wrap/worker-key-v1'),
  )
  const plaintext = openGCM(dataKey, payloadNonce, payloadCiphertext, Buffer.from([
    'sauryctf/instance-secrets.v1/payload',
    context.platform_id,
    context.provider,
    context.contest_id,
    context.contest_challenge_id,
    context.team_id,
    context.instance_id,
    String(targetContext.generation),
  ].join('\n')))
  return JSON.parse(plaintext.toString('utf8')) as unknown
}

function openGCM(key: Buffer, nonce: Buffer, ciphertextAndTag: Buffer, associatedData: Buffer): Buffer {
  const ciphertext = ciphertextAndTag.subarray(0, -16)
  const tag = ciphertextAndTag.subarray(-16)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAAD(associatedData)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}
