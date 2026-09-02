import { describe, expect, it } from 'vitest'
import { parseBlobMigrationBackend } from './blob-migration-config'

describe('Blob migration backend configuration', () => {
  it('requires explicit source and target drivers without exposing values in errors', () => {
    expect(() => parseBlobMigrationBackend({
      BLOB_MIGRATION_SOURCE_DRIVER: 's3',
      BLOB_MIGRATION_SOURCE_S3_ACCESS_KEY_ID: 'do-not-leak',
    }, 'SOURCE')).toThrow(
      'BLOB_MIGRATION_SOURCE_S3_SECRET_ACCESS_KEY, BLOB_MIGRATION_SOURCE_S3_BUCKET, BLOB_MIGRATION_SOURCE_S3_REGION',
    )
    try {
      parseBlobMigrationBackend({
        BLOB_MIGRATION_SOURCE_DRIVER: 's3',
        BLOB_MIGRATION_SOURCE_S3_ACCESS_KEY_ID: 'do-not-leak',
      }, 'SOURCE')
    }
    catch (error) {
      expect(String(error)).not.toContain('do-not-leak')
    }
  })

  it('resolves an explicit fs directory and accepts a complete target S3 group', () => {
    expect(parseBlobMigrationBackend({
      BLOB_MIGRATION_SOURCE_DRIVER: 'fs',
      BLOB_MIGRATION_SOURCE_DIR: './private-blob',
    }, 'SOURCE')).toMatchObject({ driver: 'fs', directory: expect.stringContaining('/private-blob') })
    expect(parseBlobMigrationBackend({
      BLOB_MIGRATION_TARGET_DRIVER: 's3',
      BLOB_MIGRATION_TARGET_S3_ACCESS_KEY_ID: 'access',
      BLOB_MIGRATION_TARGET_S3_SECRET_ACCESS_KEY: 'secret',
      BLOB_MIGRATION_TARGET_S3_BUCKET: 'bucket',
      BLOB_MIGRATION_TARGET_S3_REGION: 'us-east-1',
      BLOB_MIGRATION_TARGET_S3_ENDPOINT: 'http://127.0.0.1:19000',
    }, 'TARGET')).toEqual({
      driver: 's3', accessKeyId: 'access', secretAccessKey: 'secret', bucket: 'bucket',
      region: 'us-east-1', endpoint: 'http://127.0.0.1:19000',
    })
  })
})
