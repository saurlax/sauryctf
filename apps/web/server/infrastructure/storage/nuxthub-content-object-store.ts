import type { BlobObject, BlobStorage } from '@nuxthub/core/blob'
import type {
  ContentObjectStore,
  StoredContentObject,
} from '../../domains/content/service'

const sha256MetadataKey = 'sauryctfSha256'

export interface ListedContentObject extends StoredContentObject {
  storageKey: string
  customMetadata: Record<string, string>
}

export interface ContentObjectListPage {
  objects: ListedContentObject[]
  cursor?: string
}

export class ContentObjectStorageConflictError extends Error {
  constructor(readonly storageKey: string) {
    super('Content object storage key already contains different immutable data')
    this.name = 'ContentObjectStorageConflictError'
  }
}

export class NuxtHubContentObjectStore implements ContentObjectStore {
  constructor(private readonly storage: BlobStorage) {}

  async put(input: {
    storageKey: string
    body: Uint8Array
    sizeBytes: number
    sha256Hex: string
    mediaType: string
  }): Promise<void> {
    validateStorageKey(input.storageKey)
    const existing = await this.stat(input.storageKey)
    if (existing) {
      if (existing.sizeBytes === input.sizeBytes
        && existing.sha256Hex === input.sha256Hex
        && existing.mediaType === input.mediaType) return
      throw new ContentObjectStorageConflictError(input.storageKey)
    }
    await this.storage.put(input.storageKey, input.body, {
      access: 'private',
      addRandomSuffix: false,
      contentLength: String(input.sizeBytes),
      contentType: input.mediaType,
      customMetadata: {
        [sha256MetadataKey]: input.sha256Hex,
      },
    })
  }

  async stat(storageKey: string): Promise<StoredContentObject | null> {
    validateStorageKey(storageKey)
    let object: BlobObject
    try {
      object = await this.storage.head(storageKey)
    }
    catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
    return storedObject(object)
  }

  async read(storageKey: string): Promise<Uint8Array | null> {
    validateStorageKey(storageKey)
    const body = await this.storage.get(storageKey)
    if (!body) return null
    return new Uint8Array(await body.arrayBuffer())
  }

  async delete(storageKey: string): Promise<void> {
    validateStorageKey(storageKey)
    await this.storage.del(storageKey)
  }

  async list(options: { prefix?: string, cursor?: string, limit?: number } = {}): Promise<ContentObjectListPage> {
    if (options.prefix) validateStoragePrefix(options.prefix)
    const result = await this.storage.list(options)
    const objects = (await Promise.all(result.blobs.map(async (listed) => {
      const metadata = await this.headObject(listed.pathname)
      if (!metadata) return null
      return {
        storageKey: metadata.pathname,
        ...storedObject(metadata),
        customMetadata: { ...metadata.customMetadata },
      }
    }))).filter((object): object is ListedContentObject => object !== null)
    return { objects, ...(result.cursor ? { cursor: result.cursor } : {}) }
  }

  async ready(): Promise<void> {
    await this.storage.list({ limit: 1 })
  }

  close(): void {}

  private async headObject(storageKey: string): Promise<BlobObject | null> {
    try {
      return await this.storage.head(storageKey)
    }
    catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }
}

function storedObject(object: BlobObject): StoredContentObject {
  const sizeBytes = object.size
  const sha256Hex = object.customMetadata[sha256MetadataKey]
  const mediaType = object.contentType
  if (sizeBytes === undefined || !mediaType || !sha256Hex) {
    throw new Error('Stored content object is missing required immutable metadata')
  }
  return { sizeBytes, mediaType, sha256Hex }
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { status?: number, statusCode?: number }
  return candidate.status === 404 || candidate.statusCode === 404
}

function validateStorageKey(storageKey: string): void {
  if (!storageKey || storageKey.startsWith('/') || storageKey.includes('\0')) {
    throw new TypeError('Content storage key is invalid')
  }
  const segments = storageKey.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new TypeError('Content storage key is invalid')
  }
}

function validateStoragePrefix(prefix: string): void {
  if (prefix.startsWith('/') || prefix.includes('\0') || prefix.split('/').some(segment => segment === '..')) {
    throw new TypeError('Content storage prefix is invalid')
  }
}
