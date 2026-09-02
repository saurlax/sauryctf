import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { inspectDataServicesConfig } from '../config/data-services'
import { S3ContentObjectStore, type S3ContentObjectStoreConfig } from './s3-content-object-store'

const endpoint = process.env.TEST_S3_ENDPOINT
const describeWithS3 = endpoint ? describe : describe.skip

describeWithS3('NuxtHub MinIO S3 integration', () => {
  const config: S3ContentObjectStoreConfig = {
    endpoint,
    region: process.env.TEST_S3_REGION ?? 'us-east-1',
    bucket: process.env.TEST_S3_BUCKET ?? 'sauryctf',
    accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? 'sauryctf',
    secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'sauryctf-dev-secret',
  }

  it('uses the custom endpoint and preserves bytes, digest metadata, list and delete semantics', async () => {
    const store = new S3ContentObjectStore(config)
    const storageKey = `integration/${randomUUID()}/object.bin`
    const body = new TextEncoder().encode(`nuxthub-s3-${randomUUID()}`)
    const sha256Hex = createHash('sha256').update(body).digest('hex')
    try {
      await store.put({
        storageKey,
        body,
        sizeBytes: body.byteLength,
        sha256Hex,
        mediaType: 'application/octet-stream',
      })
      await expect(store.read(storageKey)).resolves.toEqual(body)
      await expect(store.stat(storageKey)).resolves.toEqual({
        sizeBytes: body.byteLength,
        sha256Hex,
        mediaType: 'application/octet-stream',
      })
      await expect(store.list({ prefix: storageKey.slice(0, storageKey.lastIndexOf('/') + 1) }))
        .resolves.toMatchObject({ objects: [expect.objectContaining({ storageKey, sha256Hex })] })
      await store.delete(storageKey)
      await expect(store.stat(storageKey)).resolves.toBeNull()
    }
    finally {
      await store.delete(storageKey)
    }
  })
})

describe('S3 selection failures', () => {
  it('rejects partial S3 settings instead of constructing the fs backend', () => {
    const result = inspectDataServicesConfig({
      DATABASE_URL: 'postgresql://database.invalid/sauryctf',
      S3_ENDPOINT: 'http://127.0.0.1:19000',
      S3_BUCKET: 'sauryctf',
    })
    expect(result.success).toBe(false)
    if (result.success) throw new TypeError('Expected partial S3 configuration to fail')
    expect(Object.keys(result.error.fields)).toEqual([
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_REGION',
    ])
  })

  it('keeps an unavailable selected S3 backend authoritative without creating an fs fallback', async () => {
    const store = new S3ContentObjectStore({
      endpoint: 'http://127.0.0.1:1',
      region: 'us-east-1',
      bucket: 'unavailable',
      accessKeyId: 'private-access',
      secretAccessKey: 'private-secret',
    })
    await expect(store.ready()).rejects.toThrow('fetch failed')
  })
})
