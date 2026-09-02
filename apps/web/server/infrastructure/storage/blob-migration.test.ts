import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { StoredContentObject } from '../../domains/content/service'
import {
  assertBlobMigrationComplete,
  BlobMigrationError,
  loadCommittedBlobManifest,
  migrateCommittedBlobs,
  type BlobMigrationEntry,
} from './blob-migration'

describe('manifest-driven Blob migration', () => {
  const first = entry('committed/first', 'first body')
  const second = entry('committed/second', 'second body')

  it('loads only the ordered committed-object projection without deployment details', async () => {
    const query = vi.fn(async (_text: string) => ({ rows: [{
      storage_key: first.storageKey,
      size_bytes: String(first.sizeBytes),
      sha256_hex: first.sha256Hex,
      media_type: first.mediaType,
    }], rowCount: 1 }))
    await expect(loadCommittedBlobManifest({ query } as never)).resolves.toEqual([first])
    expect(query.mock.calls[0]?.[0]).toContain("WHERE status = 'committed'")
  })

  it('copies and verifies every object before declaring the target ready to switch', async () => {
    const source = memoryStore([[first, bytes('first body')], [second, bytes('second body')]])
    const target = memoryStore()
    await expect(migrateCommittedBlobs([first, second], source, target)).resolves.toEqual({
      copied: 2, skipped: 0, total: 2, readyToSwitch: true,
    })
    await expect(assertBlobMigrationComplete([first, second], target)).resolves.toBeUndefined()
  })

  it('resumes after interruption and skips the object already verified at the target', async () => {
    const source = memoryStore([[first, bytes('first body')], [second, bytes('second body')]])
    const target = memoryStore()
    const originalPut = target.put
    let attempts = 0
    target.put = vi.fn(async (input) => {
      attempts++
      if (attempts === 2) throw new Error('interrupted')
      return originalPut(input)
    })

    await expect(migrateCommittedBlobs([first, second], source, target)).rejects.toThrow('interrupted')
    await expect(migrateCommittedBlobs([first, second], source, target)).resolves.toEqual({
      copied: 1, skipped: 1, total: 2, readyToSwitch: true,
    })
  })

  it('blocks missing sources, corrupt bytes and incomplete target preflight', async () => {
    await expect(migrateCommittedBlobs([first], memoryStore(), memoryStore()))
      .rejects.toMatchObject({ code: 'source_missing' })

    const corruptSource = memoryStore([[first, bytes('corrupt')]])
    corruptSource.objects.get(first.storageKey)!.metadata = metadata(first)
    await expect(migrateCommittedBlobs([first], corruptSource, memoryStore()))
      .rejects.toMatchObject({ code: 'source_mismatch' })

    await expect(assertBlobMigrationComplete([first], memoryStore()))
      .rejects.toBeInstanceOf(BlobMigrationError)
  })
})

function entry(storageKey: string, value: string): BlobMigrationEntry {
  const body = bytes(value)
  return {
    storageKey,
    sizeBytes: body.byteLength,
    sha256Hex: createHash('sha256').update(body).digest('hex'),
    mediaType: 'application/octet-stream',
  }
}

function bytes(value: string) {
  return new TextEncoder().encode(value)
}

function metadata(value: BlobMigrationEntry): StoredContentObject {
  return { sizeBytes: value.sizeBytes, sha256Hex: value.sha256Hex, mediaType: value.mediaType }
}

function memoryStore(initial: Array<[BlobMigrationEntry, Uint8Array]> = []) {
  const objects = new Map(initial.map(([item, body]) => [item.storageKey, {
    metadata: metadata(item),
    body,
  }]))
  return {
    objects,
    async stat(storageKey: string) {
      return objects.get(storageKey)?.metadata ?? null
    },
    async read(storageKey: string) {
      return objects.get(storageKey)?.body ?? null
    },
    async put(input: BlobMigrationEntry & { body: Uint8Array }) {
      objects.set(input.storageKey, { metadata: metadata(input), body: Uint8Array.from(input.body) })
    },
  }
}
