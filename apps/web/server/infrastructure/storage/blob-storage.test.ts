import type { BlobStorage } from '@nuxthub/core/blob'
import { describe, expect, it, vi } from 'vitest'
import { NuxtHubBlobStorageFactory } from './blob-storage'

describe('NuxtHub Blob storage factory', () => {
  it('initializes one fs storage for concurrent callers', async () => {
    const storage = { driver: { name: 'fs' } } as BlobStorage
    const createBlobStorage = vi.fn(() => storage)
    const createFileSystemDriver = vi.fn(() => ({ name: 'fs' }))
    const factory = new NuxtHubBlobStorageFactory(
      { driver: 'fs', directory: '/srv/private/blob' },
      {
        createBlobStorage: createBlobStorage as never,
        createFileSystemDriver: createFileSystemDriver as never,
        createS3Driver: vi.fn() as never,
      },
    )

    const resolved = await Promise.all(Array.from({ length: 20 }, () => factory.get()))

    expect(resolved.every(value => value === storage)).toBe(true)
    expect(createFileSystemDriver).toHaveBeenCalledOnce()
    expect(createFileSystemDriver).toHaveBeenCalledWith({ dir: '/srv/private/blob' })
    expect(createBlobStorage).toHaveBeenCalledOnce()
  })

  it('passes complete runtime S3 configuration to the official driver without logging it', async () => {
    const createS3Driver = vi.fn(() => ({ name: 's3' }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const factory = new NuxtHubBlobStorageFactory(
      {
        driver: 's3',
        accessKeyId: 'private-access',
        secretAccessKey: 'private-secret',
        bucket: 'private-bucket',
        region: 'us-east-1',
        endpoint: 'http://minio:9000',
      },
      {
        createBlobStorage: vi.fn(driver => ({ driver })) as never,
        createFileSystemDriver: vi.fn() as never,
        createS3Driver: createS3Driver as never,
      },
    )

    await factory.get()

    expect(createS3Driver).toHaveBeenCalledOnce()
    expect(createS3Driver).toHaveBeenCalledWith({
      accessKeyId: 'private-access',
      secretAccessKey: 'private-secret',
      bucket: 'private-bucket',
      region: 'us-east-1',
      endpoint: 'http://minio:9000',
    })
    expect(log).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })
})
