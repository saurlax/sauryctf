import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDataServicesConfig } from './data-services'

describe('.env.example data-service profiles', () => {
  it('uses fs by default and contains a complete opt-in S3 template', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../../../../../.env.example', import.meta.url)),
      'utf8',
    )
    const active = parseAssignments(source, false)
    expect(parseDataServicesConfig(active, '/workspace/apps/web').blob).toEqual({
      driver: 'fs',
      directory: '/workspace/apps/web/.data/blob',
    })
    expect(active.CONTROL_PLANE_REPLICA_COUNT).toBe('1')
    expect(active.S3_FORCE_PATH_STYLE).toBeUndefined()

    const withTemplate = { ...active, ...parseAssignments(source, true) }
    expect(parseDataServicesConfig(withTemplate, '/workspace/apps/web').blob).toEqual({
      driver: 's3',
      accessKeyId: 'sauryctf',
      secretAccessKey: 'sauryctf-dev-secret',
      bucket: 'sauryctf',
      region: 'us-east-1',
      endpoint: 'http://127.0.0.1:19000',
    })
    expect(source).toContain('S3_FORCE_PATH_STYLE is deprecated and ignored')
  })
})

function parseAssignments(source: string, commented: boolean) {
  const environment: Record<string, string> = {}
  for (const line of source.split(/\r?\n/u)) {
    const candidate = commented ? line.match(/^# (S3_[A-Z0-9_]+)=(.*)$/u) : line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/u)
    if (candidate) environment[candidate[1]!] = candidate[2]!
  }
  return environment
}
