import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ControlPlaneDataServicesReadiness, NuxtHubBlobReadiness } from './readiness'

describe('NuxtHub Blob readiness', () => {
  const directories: string[] = []

  afterEach(async () => {
    for (const directory of directories.splice(0)) {
      await chmod(directory, 0o700).catch(() => {})
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('creates and reuses the configured local persistence directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sauryctf-blob-ready-'))
    directories.push(root)
    const directory = join(root, 'nested', 'blob')
    const probe = { ready: vi.fn(async () => {}) }
    const readiness = new NuxtHubBlobReadiness({ driver: 'fs', directory }, probe)

    await readiness.ready()
    await readiness.ready()

    expect(probe.ready).toHaveBeenCalledTimes(2)
  })

  it('reports an unwritable local directory without exposing its absolute path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sauryctf-blob-denied-private-'))
    directories.push(directory)
    await chmod(directory, 0o400)
    const readiness = new NuxtHubBlobReadiness(
      { driver: 'fs', directory },
      { ready: vi.fn(async () => {}) },
    )

    const error = await readiness.ready().catch(value => value as Error)

    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) throw new TypeError('Expected readiness failure')
    expect(error.message).toBe('Authoritative fs Blob backend is unavailable')
    expect(error.message).not.toContain(directory)
  })

  it('does not fall back when the selected S3 probe fails', async () => {
    const readiness = new NuxtHubBlobReadiness({
      driver: 's3',
      accessKeyId: 'private-access',
      secretAccessKey: 'private-secret',
      bucket: 'private-bucket',
      region: 'us-east-1',
    }, {
      ready: vi.fn(async () => { throw new Error('endpoint leaked detail') }),
    })

    const error = await readiness.ready().catch(value => value as Error)
    if (!(error instanceof Error)) throw new TypeError('Expected readiness failure')
    expect(error.message).toBe('Authoritative s3 Blob backend is unavailable')
    expect(error.message).not.toContain('private')
    expect(error.message).not.toContain('endpoint')
  })

  it('projects only safe backend kinds, migration state and health', async () => {
    const postgresql = { ready: vi.fn(async () => {}) }
    const blob = { ready: vi.fn(async () => { throw new Error('s3://access:secret@private-bucket') }) }
    const readiness = new ControlPlaneDataServicesReadiness(postgresql, blob, 's3')

    const projection = await readiness.inspect()

    expect(projection).toEqual({
      postgresql: { status: 'ready', migrations: 'current' },
      blob: { driver: 's3', status: 'unavailable' },
    })
    expect(JSON.stringify(projection)).not.toMatch(/access|secret|bucket|endpoint|directory/u)
    await expect(readiness.ready()).rejects.toThrow()
  })
})
