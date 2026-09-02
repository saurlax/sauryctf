import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBlobStorage } from '@nuxthub/core/blob'
import { createDriver as createFileSystemDriver } from '@nuxthub/core/blob/drivers/fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ContentObjectStorageConflictError,
  NuxtHubContentObjectStore,
} from './nuxthub-content-object-store'

describe('NuxtHub content object storage contract', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  })

  async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'sauryctf-blob-contract-'))
    directories.push(directory)
    const blob = createBlobStorage(createFileSystemDriver({ dir: directory }))
    return new NuxtHubContentObjectStore(blob)
  }

  it('round-trips ArrayBuffer views, media type, digest metadata, head and list', async () => {
    const store = await fixture()
    const body = new Uint8Array([0, 1, 2, 127, 128, 255])
    const input = {
      storageKey: 'temporary/018f47a2.bin',
      body,
      sizeBytes: body.byteLength,
      sha256Hex: 'e'.repeat(64),
      mediaType: 'application/octet-stream',
    }

    await store.put(input)

    await expect(store.read(input.storageKey)).resolves.toEqual(body)
    await expect(store.stat(input.storageKey)).resolves.toEqual({
      sizeBytes: body.byteLength,
      sha256Hex: input.sha256Hex,
      mediaType: input.mediaType,
    })
    await expect(store.list({ prefix: 'temporary/' })).resolves.toEqual({
      objects: [{
        storageKey: input.storageKey,
        sizeBytes: body.byteLength,
        sha256Hex: input.sha256Hex,
        mediaType: input.mediaType,
        customMetadata: { sauryctfSha256: input.sha256Hex },
      }],
    })
  })

  it('makes an identical put idempotent and rejects a conflicting body for the same key', async () => {
    const store = await fixture()
    const input = {
      storageKey: 'temporary/stable-key',
      body: new Uint8Array([1, 2, 3]),
      sizeBytes: 3,
      sha256Hex: 'a'.repeat(64),
      mediaType: 'application/octet-stream',
    }
    await store.put(input)
    await expect(store.put(input)).resolves.toBeUndefined()
    await expect(store.put({ ...input, sha256Hex: 'b'.repeat(64) }))
      .rejects.toBeInstanceOf(ContentObjectStorageConflictError)
  })

  it('returns null for missing data, deletes idempotently and rejects traversal keys', async () => {
    const store = await fixture()
    await expect(store.stat('temporary/missing')).resolves.toBeNull()
    await expect(store.read('temporary/missing')).resolves.toBeNull()
    await expect(store.delete('temporary/missing')).resolves.toBeUndefined()
    await expect(store.read('../private')).rejects.toThrow('storage key is invalid')
    await expect(store.list({ prefix: '../' })).rejects.toThrow('storage prefix is invalid')
  })
})
