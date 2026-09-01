import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type {
  ContentDownloadUrlSigner,
} from '../../domains/content/download-service'
import type {
  ContentObjectStore,
  StoredContentObject,
} from '../../domains/content/service'

export interface S3ContentObjectStoreConfig {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

export class S3ContentObjectStore implements ContentObjectStore, ContentDownloadUrlSigner {
  private readonly client: S3Client

  constructor(private readonly config: S3ContentObjectStoreConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
  }

  async put(input: {
    storageKey: string
    body: Uint8Array
    sizeBytes: number
    sha256Hex: string
    mediaType: string
  }): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.storageKey,
      Body: input.body,
      ContentLength: input.sizeBytes,
      ContentType: input.mediaType,
      IfNoneMatch: '*',
      Metadata: {
        'sauryctf-sha256': input.sha256Hex,
      },
    }))
  }

  async stat(storageKey: string): Promise<StoredContentObject | null> {
    try {
      const response = await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: storageKey,
      }))
      const sizeBytes = response.ContentLength
      const mediaType = response.ContentType
      const sha256Hex = response.Metadata?.['sauryctf-sha256']
      if (sizeBytes === undefined || !mediaType || !sha256Hex) {
        throw new Error('Stored content object is missing required immutable metadata')
      }
      return { sizeBytes, mediaType, sha256Hex }
    }
    catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async read(storageKey: string): Promise<Uint8Array | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: storageKey,
      }))
      if (!response.Body) throw new Error('Stored content object returned an empty response body')
      return await response.Body.transformToByteArray()
    }
    catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async delete(storageKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: storageKey,
    }))
  }

  async signDownloadUrl(input: {
    storageKey: string
    contentDisposition: string
    responseMediaType: string
    expiresInSeconds: number
  }): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: input.storageKey,
      ResponseContentDisposition: input.contentDisposition,
      ResponseContentType: input.responseMediaType,
    }), { expiresIn: input.expiresInSeconds })
  }

  close(): void {
    this.client.destroy()
  }
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: string, $metadata?: { httpStatusCode?: number } }
  return candidate.name === 'NoSuchKey'
    || candidate.name === 'NotFound'
    || candidate.$metadata?.httpStatusCode === 404
}
