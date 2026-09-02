import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DataServicesConfigurationError,
  inspectDataServicesConfig,
  parseDataServicesConfig,
} from './data-services'

const database = {
  DATABASE_URL: 'postgresql://runtime-user:runtime-password@database:5432/sauryctf',
}

const completeS3 = {
  S3_ACCESS_KEY_ID: 'runtime-access-key',
  S3_SECRET_ACCESS_KEY: 'runtime-secret-key',
  S3_BUCKET: 'runtime-bucket',
  S3_REGION: 'us-east-1',
  S3_ENDPOINT: 'http://minio:9000',
}

describe('data services configuration', () => {
  it('requires PostgreSQL and never selects an embedded database', () => {
    const result = inspectDataServicesConfig({})
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.fields).toHaveProperty('DATABASE_URL')
  })

  it('selects the NuxtHub S3 driver only for a complete group', () => {
    expect(parseDataServicesConfig({ ...database, ...completeS3 }, '/srv/web')).toEqual({
      database: { dialect: 'postgresql', url: database.DATABASE_URL },
      controlPlaneReplicaCount: 1,
      blob: {
        driver: 's3',
        accessKeyId: completeS3.S3_ACCESS_KEY_ID,
        secretAccessKey: completeS3.S3_SECRET_ACCESS_KEY,
        bucket: completeS3.S3_BUCKET,
        region: completeS3.S3_REGION,
        endpoint: completeS3.S3_ENDPOINT,
      },
    })
  })

  it('accepts AWS S3 without a custom endpoint', () => {
    const { S3_ENDPOINT: _endpoint, ...awsS3 } = completeS3
    expect(parseDataServicesConfig({ ...database, ...awsS3 }).blob).toMatchObject({
      driver: 's3',
      region: 'us-east-1',
    })
  })

  it('selects persistent local storage when every S3 variable is absent or blank', () => {
    const config = parseDataServicesConfig({
      ...database,
      S3_ACCESS_KEY_ID: ' ',
      S3_SECRET_ACCESS_KEY: '',
      S3_BUCKET: undefined,
      S3_REGION: '',
      S3_ENDPOINT: ' ',
    }, '/workspace/apps/web')
    expect(config.blob).toEqual({
      driver: 'fs',
      directory: resolve('/workspace/apps/web', '.data/blob'),
    })
  })

  it('uses NUXTHUB_BLOB_DIR and resolves relative paths from the web application root', () => {
    const relative = parseDataServicesConfig({
      ...database,
      NUXTHUB_BLOB_DIR: 'persistent/content',
    }, '/workspace/apps/web')
    const absolute = parseDataServicesConfig({
      ...database,
      NUXTHUB_BLOB_DIR: '/var/lib/sauryctf/blob',
    }, '/workspace/apps/web')
    expect(relative.blob).toEqual({
      driver: 'fs',
      directory: '/workspace/apps/web/persistent/content',
    })
    expect(absolute.blob).toEqual({
      driver: 'fs',
      directory: '/var/lib/sauryctf/blob',
    })
  })

  it.each([
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_BUCKET',
    'S3_REGION',
  ] as const)('rejects partial S3 configuration missing %s', (field) => {
    const environment = { ...database, ...completeS3, [field]: undefined }
    const result = inspectDataServicesConfig(environment)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.fields).toHaveProperty(field)
  })

  it('treats a standalone endpoint as partial S3 configuration', () => {
    const result = inspectDataServicesConfig({ ...database, S3_ENDPOINT: 'http://minio:9000' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(Object.keys(result.error.fields)).toEqual(expect.arrayContaining([
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_BUCKET',
      'S3_REGION',
    ]))
  })

  it('rejects multiple replicas with local Blob and accepts them with S3', () => {
    expect(() => parseDataServicesConfig({
      ...database,
      CONTROL_PLANE_REPLICA_COUNT: '2',
    })).toThrow(DataServicesConfigurationError)
    expect(parseDataServicesConfig({
      ...database,
      ...completeS3,
      CONTROL_PLANE_REPLICA_COUNT: '2',
    }).controlPlaneReplicaCount).toBe(2)
  })

  it.each(['0', '-1', '1.5', 'many'])('rejects invalid replica count %s', (value) => {
    const result = inspectDataServicesConfig({ ...database, CONTROL_PLANE_REPLICA_COUNT: value })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.fields).toHaveProperty('CONTROL_PLANE_REPLICA_COUNT')
  })

  it('reports only field names and never echoes credentials', () => {
    const result = inspectDataServicesConfig({
      ...database,
      S3_ACCESS_KEY_ID: 'do-not-leak-access',
      S3_SECRET_ACCESS_KEY: 'do-not-leak-secret',
    })
    expect(result.success).toBe(false)
    if (result.success) return
    const serialized = JSON.stringify(result.error)
    expect(serialized).not.toContain('do-not-leak-access')
    expect(serialized).not.toContain('do-not-leak-secret')
    expect(result.error.message).not.toContain(database.DATABASE_URL)
  })
})
