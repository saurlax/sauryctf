import { createBlobStorage, type BlobStorage } from '@nuxthub/core/blob'
import { createDriver as createFileSystemDriver } from '@nuxthub/core/blob/drivers/fs'
import { createDriver as createS3Driver } from '@nuxthub/core/blob/drivers/s3'
import type { DataServicesConfig } from '../config/data-services'

export type BlobBackendConfig = DataServicesConfig['blob']

interface BlobStorageFactoryDependencies {
  createBlobStorage: typeof createBlobStorage
  createFileSystemDriver: typeof createFileSystemDriver
  createS3Driver: typeof createS3Driver
}

const defaultDependencies: BlobStorageFactoryDependencies = {
  createBlobStorage,
  createFileSystemDriver,
  createS3Driver,
}

/**
 * Server-only lazy factory. The resolved configuration is immutable, so one
 * process cannot start writing to a second backend after initialization.
 */
export class NuxtHubBlobStorageFactory {
  readonly #config: BlobBackendConfig
  readonly #dependencies: BlobStorageFactoryDependencies
  #storage: Promise<BlobStorage> | undefined

  constructor(
    config: BlobBackendConfig,
    dependencies: BlobStorageFactoryDependencies = defaultDependencies,
  ) {
    this.#config = config
    this.#dependencies = dependencies
  }

  get(): Promise<BlobStorage> {
    this.#storage ??= Promise.resolve().then(() => {
      const driver = this.#config.driver === 'fs'
        ? this.#dependencies.createFileSystemDriver({ dir: this.#config.directory })
        : this.#dependencies.createS3Driver({
            accessKeyId: this.#config.accessKeyId,
            secretAccessKey: this.#config.secretAccessKey,
            bucket: this.#config.bucket,
            region: this.#config.region,
            ...(this.#config.endpoint ? { endpoint: this.#config.endpoint } : {}),
          })
      return this.#dependencies.createBlobStorage(driver)
    })
    return this.#storage
  }
}

let processFactory: NuxtHubBlobStorageFactory | undefined

export function getControlPlaneBlobStorage(config: BlobBackendConfig): Promise<BlobStorage> {
  processFactory ??= new NuxtHubBlobStorageFactory(config)
  return processFactory.get()
}
