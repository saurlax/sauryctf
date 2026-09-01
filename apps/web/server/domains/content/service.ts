import { createHash, randomUUID } from 'node:crypto'

export const maximumContentObjectBytes = 64 * 1024 * 1024
export const contentGarbageGracePeriodMs = 24 * 60 * 60 * 1000

export type ContentObjectStatus = 'temporary' | 'committed' | 'quarantined' | 'deleted'

export interface ContentObject {
  id: string
  storageKey: string
  sha256Hex: string
  sizeBytes: number
  mediaType: string
  originalFilename: string
  status: ContentObjectStatus
  createdBy: string
  committedAt: Date | null
  createdAt: Date
}

export interface StoredContentObject {
  sizeBytes: number
  sha256Hex: string
  mediaType: string
}

export interface ContentObjectStore {
  put(input: {
    storageKey: string
    body: Uint8Array
    sizeBytes: number
    sha256Hex: string
    mediaType: string
  }): Promise<void>
  stat(storageKey: string): Promise<StoredContentObject | null>
  read(storageKey: string): Promise<Uint8Array | null>
  delete(storageKey: string): Promise<void>
  close(): void
}

export interface ContentObjectRepository {
  registerTemporary(input: {
    storageKey: string
    sha256Digest: Buffer
    sizeBytes: number
    mediaType: string
    originalFilename: string
    createdBy: string
    createdAt: Date
  }): Promise<{ object: ContentObject, inserted: boolean }>
  findOwned(objectId: string, userId: string): Promise<ContentObject | null>
  find(objectId: string): Promise<ContentObject | null>
  commitTemporary(objectId: string, userId: string, sha256Digest: Buffer, committedAt: Date): Promise<ContentObject | null>
  claimGarbage(cutoff: Date, limit: number): Promise<ContentObject[]>
  confirmGarbageUnreferenced(objectId: string, storageKey: string): Promise<boolean>
  markDeleted(objectId: string, storageKey: string): Promise<boolean>
}

export class ContentObjectServiceError extends Error {
  constructor(readonly code:
    | 'content.digest_invalid'
    | 'content.digest_mismatch'
    | 'content.filename_invalid'
    | 'content.media_type_invalid'
    | 'content.object_not_found'
    | 'content.object_not_temporary'
    | 'content.storage_mismatch'
    | 'content.upload_conflict'
    | 'content.upload_empty'
    | 'content.upload_too_large', message: string) {
    super(message)
    this.name = 'ContentObjectServiceError'
  }
}

export class ContentGarbageCollectionError extends Error {
  constructor(readonly failures: ReadonlyArray<{ objectId: string, error: unknown }>) {
    super(`Failed to collect ${failures.length} content object(s)`)
    this.name = 'ContentGarbageCollectionError'
  }
}

export class ContentObjectService {
  constructor(
    private readonly repository: ContentObjectRepository,
    private readonly store: ContentObjectStore,
    private readonly now: () => Date = () => new Date(),
    private readonly storageKeyFactory: () => string = () => `temporary/${randomUUID()}`,
  ) {}

  async uploadTemporary(userId: string, input: {
    body: Uint8Array
    mediaType: string
    originalFilename: string
  }): Promise<ContentObject> {
    if (input.body.byteLength === 0) {
      throw new ContentObjectServiceError('content.upload_empty', '上传内容不能为空')
    }
    if (input.body.byteLength > maximumContentObjectBytes) {
      throw new ContentObjectServiceError('content.upload_too_large', '上传内容超过 64 MiB 限制')
    }
    const originalFilename = sanitizeOriginalFilename(input.originalFilename)
    const mediaType = normalizeMediaType(input.mediaType)
    const sha256Digest = createHash('sha256').update(input.body).digest()
    const sha256Hex = sha256Digest.toString('hex')
    const storageKey = this.storageKeyFactory()

    await this.store.put({
      storageKey,
      body: input.body,
      sizeBytes: input.body.byteLength,
      sha256Hex,
      mediaType,
    })

    let registered: { object: ContentObject, inserted: boolean }
    try {
      registered = await this.repository.registerTemporary({
        storageKey,
        sha256Digest,
        sizeBytes: input.body.byteLength,
        mediaType,
        originalFilename,
        createdBy: userId,
        createdAt: this.now(),
      })
    }
    catch (error) {
      await this.bestEffortDelete(storageKey)
      throw error
    }

    if (!registered.inserted) {
      await this.bestEffortDelete(storageKey)
      if (registered.object.status === 'committed') return registered.object
      if (registered.object.status === 'temporary' && registered.object.createdBy === userId) {
        return registered.object
      }
      throw new ContentObjectServiceError(
        'content.upload_conflict',
        '相同内容正在由另一项上传处理，请稍后重试',
      )
    }
    return registered.object
  }

  async commitTemporary(userId: string, objectId: string, expectedSha256Hex: string): Promise<ContentObject> {
    const expectedDigest = parseSha256(expectedSha256Hex)
    const current = await this.repository.findOwned(objectId, userId)
    if (!current || current.status === 'deleted') {
      throw new ContentObjectServiceError('content.object_not_found', '内容对象不存在')
    }
    if (current.status === 'committed') {
      if (current.sha256Hex !== expectedDigest.toString('hex')) {
        throw new ContentObjectServiceError('content.digest_mismatch', '提交摘要与上传内容不一致')
      }
      return current
    }
    if (current.status !== 'temporary') {
      throw new ContentObjectServiceError('content.object_not_temporary', '内容对象当前不能提交')
    }
    if (current.sha256Hex !== expectedDigest.toString('hex')) {
      throw new ContentObjectServiceError('content.digest_mismatch', '提交摘要与上传内容不一致')
    }

    const stored = await this.store.stat(current.storageKey)
    if (!stored
      || stored.sizeBytes !== current.sizeBytes
      || stored.sha256Hex !== current.sha256Hex
      || stored.mediaType !== current.mediaType) {
      throw new ContentObjectServiceError('content.storage_mismatch', '对象存储内容与权威元数据不一致')
    }
    const committed = await this.repository.commitTemporary(
      objectId,
      userId,
      expectedDigest,
      this.now(),
    )
    if (!committed) {
      throw new ContentObjectServiceError('content.object_not_temporary', '内容对象状态已发生变化')
    }
    return committed
  }

  async createCommitted(userId: string, input: {
    body: Uint8Array
    mediaType: string
    originalFilename: string
  }): Promise<ContentObject> {
    const uploaded = await this.uploadTemporary(userId, input)
    if (uploaded.status === 'committed') return uploaded
    return this.commitTemporary(userId, uploaded.id, uploaded.sha256Hex)
  }

  async readCommitted(objectId: string): Promise<{ object: ContentObject, body: Uint8Array }> {
    return this.readCommittedObject(await this.repository.find(objectId))
  }

  async collectGarbage(limit = 100): Promise<{ collected: number }> {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
    const cutoff = new Date(this.now().getTime() - contentGarbageGracePeriodMs)
    const candidates = await this.repository.claimGarbage(cutoff, boundedLimit)
    const failures: Array<{ objectId: string, error: unknown }> = []
    let collected = 0
    for (const candidate of candidates) {
      try {
        if (!await this.repository.confirmGarbageUnreferenced(candidate.id, candidate.storageKey)) continue
        await this.store.delete(candidate.storageKey)
        if (await this.repository.markDeleted(candidate.id, candidate.storageKey)) collected++
      }
      catch (error) {
        failures.push({ objectId: candidate.id, error })
      }
    }
    if (failures.length > 0) throw new ContentGarbageCollectionError(failures)
    return { collected }
  }

  private async bestEffortDelete(storageKey: string): Promise<void> {
    try {
      await this.store.delete(storageKey)
    }
    catch {
      // The random temporary prefix is also covered by the bucket lifecycle.
    }
  }

  private async readCommittedObject(object: ContentObject | null): Promise<{
    object: ContentObject
    body: Uint8Array
  }> {
    if (!object || object.status !== 'committed' || !object.committedAt) {
      throw new ContentObjectServiceError('content.object_not_found', '已提交内容对象不存在')
    }
    const [stored, body] = await Promise.all([
      this.store.stat(object.storageKey),
      this.store.read(object.storageKey),
    ])
    if (!stored || !body
      || stored.sizeBytes !== object.sizeBytes
      || stored.sha256Hex !== object.sha256Hex
      || stored.mediaType !== object.mediaType
      || body.byteLength !== object.sizeBytes
      || createHash('sha256').update(body).digest('hex') !== object.sha256Hex) {
      throw new ContentObjectServiceError('content.storage_mismatch', '对象存储内容与权威元数据不一致')
    }
    return { object, body }
  }
}

function parseSha256(value: string): Buffer {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new ContentObjectServiceError('content.digest_invalid', '摘要必须是 SHA-256 十六进制值')
  }
  return Buffer.from(value, 'hex')
}

function sanitizeOriginalFilename(value: string): string {
  const basename = value.normalize('NFC').replaceAll('\\', '/').split('/').at(-1) ?? ''
  const sanitized = basename.replace(/[\u0000-\u001f\u007f]/gu, '_').trim()
  if (sanitized.length === 0 || sanitized === '.' || sanitized === '..') {
    throw new ContentObjectServiceError('content.filename_invalid', '文件名无效')
  }
  let bounded = ''
  for (const character of sanitized) {
    if (bounded.length + character.length > 255) break
    bounded += character
  }
  return bounded
}

function normalizeMediaType(value: string): string {
  const mediaType = value.split(';', 1)[0]!.trim().toLowerCase()
  if (mediaType.length > 255 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mediaType)) {
    throw new ContentObjectServiceError('content.media_type_invalid', '媒体类型无效')
  }
  return mediaType
}
