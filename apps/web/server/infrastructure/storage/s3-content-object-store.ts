import { createBlobStorage } from '@nuxthub/core/blob'
import { createDriver as createS3Driver } from '@nuxthub/core/blob/drivers/s3'
import { NuxtHubContentObjectStore } from './nuxthub-content-object-store'

/** @deprecated Use the runtime-selected NuxtHub Blob factory in production. */
export interface S3ContentObjectStoreConfig {
  endpoint?: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** NuxtHub's S3 driver uses path-style requests whenever endpoint is set. */
  forcePathStyle?: boolean
}

/**
 * Explicit S3 construction remains useful for isolated MinIO tests and Blob
 * migrations. Runtime service assembly uses the server-only process factory.
 */
export class S3ContentObjectStore extends NuxtHubContentObjectStore {
  constructor(config: S3ContentObjectStoreConfig) {
    super(createBlobStorage(createS3Driver({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      bucket: config.bucket,
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    })))
  }
}
