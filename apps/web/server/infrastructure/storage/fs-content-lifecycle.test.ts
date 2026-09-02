import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBlobStorage } from '@nuxthub/core/blob'
import { createDriver as createFileSystemDriver } from '@nuxthub/core/blob/drivers/fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContentDownloadService, type ContentDownloadRepository } from '../../domains/content/download-service'
import {
  ContentObjectService,
  type ContentObject,
  type ContentObjectRepository,
} from '../../domains/content/service'
import type { SessionSubject } from '../../domains/identity/repository'
import { NuxtHubContentObjectStore } from './nuxthub-content-object-store'

const firstUser = '018f47a2-4ef8-7e2c-9c24-000000000401'
const secondUser = '018f47a2-4ef8-7e2c-9c24-000000000402'

describe('local NuxtHub Blob lifecycle', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  })

  it('supports upload, authorized download, deduplication, restart persistence and garbage collection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sauryctf-fs-lifecycle-'))
    directories.push(directory)
    const repository = new MemoryContentRepository()
    const keys = ['temporary/first', 'temporary/redundant']
    const uploadedAt = new Date('2026-09-01T00:00:00.000Z')
    const firstStore = localStore(directory)
    const firstService = new ContentObjectService(repository, firstStore, () => uploadedAt, () => keys.shift()!)
    const body = new TextEncoder().encode('persistent local challenge asset')

    const committed = await firstService.createCommitted(firstUser, {
      body,
      mediaType: 'text/plain',
      originalFilename: 'challenge.txt',
    })
    const restartedStore = localStore(directory)
    const restartedService = new ContentObjectService(repository, restartedStore, () => new Date('2026-09-03T00:00:00.000Z'), () => keys.shift()!)
    await expect(restartedService.readCommitted(committed.id)).resolves.toMatchObject({ body })

    const duplicate = await restartedService.uploadTemporary(secondUser, {
      body,
      mediaType: 'text/plain',
      originalFilename: 'same.txt',
    })
    expect(duplicate.id).toBe(committed.id)
    await expect(restartedStore.stat('temporary/redundant')).resolves.toBeNull()

    const downloadRepository: ContentDownloadRepository = {
      findChallengeAsset: vi.fn(async actorId => actorId === firstUser ? {
        storageKey: committed.storageKey,
        mediaType: committed.mediaType,
        originalFilename: committed.originalFilename,
        downloadFilename: committed.originalFilename,
      } : null),
      findWriteupAttachment: vi.fn(async () => null),
    }
    const downloads = new ContentDownloadService(downloadRepository, restartedStore)
    await expect(downloads.challengeAsset(subject(secondUser), committed.id))
      .rejects.toMatchObject({ code: 'content.download_not_found' })
    const grant = await downloads.challengeAsset(subject(firstUser), committed.id)
    await expect(downloads.read(grant)).resolves.toEqual(body)

    await expect(restartedService.collectGarbage()).resolves.toEqual({ collected: 1 })
    await expect(restartedStore.stat(committed.storageKey)).resolves.toBeNull()

    await rm(directory, { recursive: true })
    directories.splice(directories.indexOf(directory), 1)
    await expect(access(directory)).rejects.toThrow()
  })
})

function localStore(directory: string) {
  return new NuxtHubContentObjectStore(createBlobStorage(createFileSystemDriver({ dir: directory })))
}

function subject(userId: string): SessionSubject {
  return {
    userId,
    username: `user-${userId.at(-1)}`,
    email: `${userId}@example.test`,
    emailVerified: true,
    status: 'active',
    role: 'user',
    sessionVersion: 1,
    mustChangePassword: false,
  }
}

class MemoryContentRepository implements ContentObjectRepository {
  readonly objects = new Map<string, ContentObject>()

  async registerTemporary(input: {
    storageKey: string
    sha256Digest: Buffer
    sizeBytes: number
    mediaType: string
    originalFilename: string
    createdBy: string
    createdAt: Date
  }) {
    const digest = input.sha256Digest.toString('hex')
    const existing = [...this.objects.values()].find(object => object.status !== 'deleted'
      && object.sha256Hex === digest && object.sizeBytes === input.sizeBytes)
    if (existing) return { object: structuredClone(existing), inserted: false }
    const object: ContentObject = {
      id: crypto.randomUUID(),
      storageKey: input.storageKey,
      sha256Hex: digest,
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

  async commitTemporary(objectId: string, userId: string, digest: Buffer, committedAt: Date) {
    const object = this.objects.get(objectId)
    if (!object || object.createdBy !== userId || object.status !== 'temporary'
      || object.sha256Hex !== digest.toString('hex')) return null
    object.status = 'committed'
    object.committedAt = committedAt
    return structuredClone(object)
  }

  async claimGarbage(cutoff: Date, limit: number) {
    const objects = [...this.objects.values()]
      .filter(object => object.status !== 'deleted'
        && (object.committedAt ?? object.createdAt) <= cutoff)
      .slice(0, limit)
    for (const object of objects) object.status = 'quarantined'
    return structuredClone(objects)
  }

  async confirmGarbageUnreferenced(objectId: string, storageKey: string) {
    const object = this.objects.get(objectId)
    return object?.status === 'quarantined' && object.storageKey === storageKey
  }

  async markDeleted(objectId: string, storageKey: string) {
    const object = this.objects.get(objectId)
    if (!object || object.status !== 'quarantined' || object.storageKey !== storageKey) return false
    object.status = 'deleted'
    return true
  }
}
