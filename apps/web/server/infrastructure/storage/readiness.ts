import { constants } from 'node:fs'
import { access, mkdir } from 'node:fs/promises'
import type { BlobBackendConfig } from './blob-storage'
import type { DataServicesHealth } from '../../../shared/contracts/monitoring'

export interface BlobBackendProbe {
  ready(): Promise<void>
}

export class NuxtHubBlobReadiness {
  constructor(
    private readonly config: BlobBackendConfig,
    private readonly storage: BlobBackendProbe,
  ) {}

  async ready(): Promise<void> {
    try {
      if (this.config.driver === 'fs') {
        await mkdir(this.config.directory, { recursive: true })
        await access(this.config.directory, constants.R_OK | constants.W_OK)
      }
      await this.storage.ready()
    }
    catch (error) {
      throw new Error(`Authoritative ${this.config.driver} Blob backend is unavailable`, { cause: error })
    }
  }
}

export class ControlPlaneDataServicesReadiness {
  constructor(
    private readonly postgresql: BlobBackendProbe,
    private readonly blob: BlobBackendProbe,
    private readonly blobDriver: 'fs' | 's3',
  ) {}

  async ready(): Promise<void> {
    await Promise.all([this.postgresql.ready(), this.blob.ready()])
  }

  async inspect(): Promise<DataServicesHealth> {
    const [postgresql, blob] = await Promise.allSettled([
      this.postgresql.ready(),
      this.blob.ready(),
    ])
    return {
      postgresql: postgresql.status === 'fulfilled'
        ? { status: 'ready', migrations: 'current' }
        : { status: 'unavailable', migrations: 'unavailable' },
      blob: {
        driver: this.blobDriver,
        status: blob.status === 'fulfilled' ? 'ready' : 'unavailable',
      },
    }
  }
}
