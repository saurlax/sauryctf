import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  ContentObjectService,
  ContentObjectServiceError,
  type ContentObject,
  type ContentObjectRepository,
  type ContentObjectStore,
  type StoredContentObject,
} from './service'

class MemoryContentRepository implements ContentObjectRepository {
  readonly objects = new Map<string, ContentObject>()
  readonly referenceCounts = new Map<string, number>()

  async registerTemporary(input: {
    storageKey: string
    sha256Digest: Buffer
    sizeBytes: number
    mediaType: string
    originalFilename: string
    createdBy: string
    createdAt: Date
  }) {
    const existing = [...this.objects.values()].find(object => object.status !== 'deleted'
      && object.sha256Hex === input.sha256Digest.toString('hex')
      && object.sizeBytes === input.sizeBytes)
    if (existing) return { object: structuredClone(existing), inserted: false }
    const object: ContentObject = {
      id: randomUUID(),
      storageKey: input.storageKey,
      sha256Hex: input.sha256Digest.toString('hex'),
      sizeBytes: input.sizeBytes,
      mediaType: input.mediaType,
      originalFilename: input.originalFilename,
      status: 'temporary',
      createdBy: input.createdBy,
      committedAt: null,
      createdAt: input.createdAt,
    }
    this.objects.set(object.id, object)
    return { object: structuredClone(object), inserted: true }
  }

  async findOwned(objectId: string, userId: string) {
    const object = this.objects.get(objectId)
    return object?.createdBy === userId ? structuredClone(object) : null
  }

  async find(objectId: string) {
    const object = this.objects.get(objectId)
    return object ? structuredClone(object) : null
  }

  async commitTemporary(objectId: string, userId: string, sha256Digest: Buffer, committedAt: Date) {
    const object = this.objects.get(objectId)
    if (!object || object.createdBy !== userId || object.status !== 'temporary'
      || object.sha256Hex !== sha256Digest.toString('hex')) return null
    object.status = 'committed'
    object.committedAt = committedAt
    return structuredClone(object)
  }

  async claimGarbage(cutoff: Date, limit: number) {
    const candidates = [...this.objects.values()].filter((object) => {
      if (object.status === 'quarantined') return true
      if ((this.referenceCounts.get(object.id) ?? 0) > 0) return false
      if (object.status === 'temporary') return object.createdAt <= cutoff
      return object.status === 'committed' && object.committedAt !== null && object.committedAt <= cutoff
    }).slice(0, limit)
    for (const object of candidates) object.status = 'quarantined'
    return structuredClone(candidates)
  }

  async markDeleted(objectId: string, storageKey: string) {
    const object = this.objects.get(objectId)
    if (!object || object.storageKey !== storageKey || object.status !== 'quarantined') return false
    object.status = 'deleted'
    return true
  }

  async confirmGarbageUnreferenced(objectId: string, storageKey: string) {
    const object = this.objects.get(objectId)
    if (!object || object.storageKey !== storageKey || object.status !== 'quarantined') return false
    if ((this.referenceCounts.get(objectId) ?? 0) === 0) return true
    object.status = object.committedAt === null ? 'temporary' : 'committed'
    return false
  }
}

class MemoryContentStore implements ContentObjectStore {
  readonly objects = new Map<string, { body: Uint8Array, metadata: StoredContentObject }>()
  readonly deleted: string[] = []

  async put(input: { storageKey: string, body: Uint8Array, sizeBytes: number, sha256Hex: string, mediaType: string }) {
    if (this.objects.has(input.storageKey)) throw new Error('storage key conflict')
    this.objects.set(input.storageKey, {
      body: Uint8Array.from(input.body),
      metadata: { sizeBytes: input.sizeBytes, sha256Hex: input.sha256Hex, mediaType: input.mediaType },
    })
  }

  async stat(storageKey: string) {
    return structuredClone(this.objects.get(storageKey)?.metadata ?? null)
  }

  async read(storageKey: string) {
    const body = this.objects.get(storageKey)?.body
    return body ? Uint8Array.from(body) : null
  }

  async delete(storageKey: string) {
    this.objects.delete(storageKey)
    this.deleted.push(storageKey)
  }

  close() {}
}

const firstUser = '018f47a2-4ef8-7e2c-9c24-000000000001'
const secondUser = '018f47a2-4ef8-7e2c-9c24-000000000002'

describe('content object lifecycle', () => {
  it('commits a digest-verified temporary upload and survives service restart', async () => {
    const now = new Date('2026-09-02T04:00:00.000Z')
    const repository = new MemoryContentRepository()
    const store = new MemoryContentStore()
    const body = Buffer.from('immutable challenge attachment')
    const firstService = new ContentObjectService(repository, store, () => now, () => 'temporary/upload-1')

    const temporary = await firstService.uploadTemporary(firstUser, {
      body,
      mediaType: 'Application/Octet-Stream; charset=binary',
      originalFilename: '../../payload.bin',
    })
    expect(temporary).toMatchObject({
      status: 'temporary',
      storageKey: 'temporary/upload-1',
      originalFilename: 'payload.bin',
      mediaType: 'application/octet-stream',
    })
    await expect(firstService.commitTemporary(firstUser, temporary.id, '0'.repeat(64)))
      .rejects.toMatchObject({ code: 'content.digest_mismatch' })

    const restartedService = new ContentObjectService(repository, store, () => now)
    const digest = createHash('sha256').update(body).digest('hex')
    const committed = await restartedService.commitTemporary(firstUser, temporary.id, digest)
    expect(committed).toMatchObject({ status: 'committed', sha256Hex: digest, committedAt: now })
    expect(Buffer.from((await store.read(committed.storageKey))!)).toEqual(body)
  })

  it('reuses a committed digest and removes the redundant temporary object', async () => {
    const repository = new MemoryContentRepository()
    const store = new MemoryContentStore()
    const body = Buffer.from('shared attachment bytes')
    const keys = ['temporary/upload-a', 'temporary/upload-b']
    const service = new ContentObjectService(repository, store, () => new Date(), () => keys.shift()!)
    const first = await service.uploadTemporary(firstUser, {
      body,
      mediaType: 'application/octet-stream',
      originalFilename: 'first.bin',
    })
    await service.commitTemporary(firstUser, first.id, createHash('sha256').update(body).digest('hex'))

    const reused = await service.uploadTemporary(secondUser, {
      body,
      mediaType: 'application/octet-stream',
      originalFilename: 'second.bin',
    })
    expect(reused.id).toBe(first.id)
    expect(reused.status).toBe('committed')
    expect(store.objects.has('temporary/upload-a')).toBe(true)
    expect(store.objects.has('temporary/upload-b')).toBe(false)
  })

  it('creates and re-reads a committed object with storage verification', async () => {
    const repository = new MemoryContentRepository()
    const store = new MemoryContentStore()
    const service = new ContentObjectService(
      repository,
      store,
      () => new Date('2026-09-02T05:00:00.000Z'),
      () => 'temporary/package',
    )
    const body = Buffer.from('portable package')
    const object = await service.createCommitted(firstUser, {
      body,
      mediaType: 'application/zip',
      originalFilename: 'contest.zip',
    })

    const read = await service.readCommitted(object.id)
    expect(read.object).toMatchObject({ id: object.id, status: 'committed' })
    expect(Buffer.from(read.body)).toEqual(body)

    store.objects.get(object.storageKey)!.body = Buffer.from('tampered package')
    await expect(service.readCommitted(object.id))
      .rejects.toMatchObject({ code: 'content.storage_mismatch' })
  })

  it('collects only objects older than 24 hours without references', async () => {
    const now = new Date('2026-09-03T12:00:00.000Z')
    const repository = new MemoryContentRepository()
    const store = new MemoryContentStore()
    const keys = ['temporary/old', 'temporary/referenced', 'temporary/recent']
    const oldTime = new Date(now.getTime() - 25 * 60 * 60 * 1000)
    const serviceAtOldTime = new ContentObjectService(repository, store, () => oldTime, () => keys.shift()!)
    const old = await serviceAtOldTime.uploadTemporary(firstUser, { body: Buffer.from('old'), mediaType: 'text/plain', originalFilename: 'old.txt' })
    const referenced = await serviceAtOldTime.uploadTemporary(firstUser, { body: Buffer.from('referenced'), mediaType: 'text/plain', originalFilename: 'referenced.txt' })
    repository.referenceCounts.set(referenced.id, 2)
    const recentService = new ContentObjectService(repository, store, () => now, () => keys.shift()!)
    const recent = await recentService.uploadTemporary(firstUser, { body: Buffer.from('recent'), mediaType: 'text/plain', originalFilename: 'recent.txt' })

    await expect(recentService.collectGarbage()).resolves.toEqual({ collected: 1 })
    expect(repository.objects.get(old.id)?.status).toBe('deleted')
    expect(repository.objects.get(referenced.id)?.status).toBe('temporary')
    expect(repository.objects.get(recent.id)?.status).toBe('temporary')
    expect(store.deleted).toContain('temporary/old')
  })

  it('rejects empty, oversized, and malformed upload metadata before registration', async () => {
    const service = new ContentObjectService(new MemoryContentRepository(), new MemoryContentStore())
    await expect(service.uploadTemporary(firstUser, { body: new Uint8Array(), mediaType: 'text/plain', originalFilename: 'empty.txt' }))
      .rejects.toBeInstanceOf(ContentObjectServiceError)
    await expect(service.uploadTemporary(firstUser, { body: Buffer.from('x'), mediaType: 'invalid', originalFilename: 'x' }))
      .rejects.toMatchObject({ code: 'content.media_type_invalid' })
    await expect(service.uploadTemporary(firstUser, { body: Buffer.from('x'), mediaType: 'text/plain', originalFilename: '..' }))
      .rejects.toMatchObject({ code: 'content.filename_invalid' })
  })

  it('bounds a Unicode display filename without splitting a surrogate pair', async () => {
    const service = new ContentObjectService(
      new MemoryContentRepository(),
      new MemoryContentStore(),
      () => new Date(),
      () => 'temporary/unicode-name',
    )
    const uploaded = await service.uploadTemporary(firstUser, {
      body: Buffer.from('unicode filename'),
      mediaType: 'text/plain',
      originalFilename: `${'🐟'.repeat(200)}.txt`,
    })

    expect(uploaded.originalFilename.length).toBeLessThanOrEqual(255)
    expect(uploaded.originalFilename).not.toMatch(/[\uD800-\uDBFF]$/u)
  })
})
