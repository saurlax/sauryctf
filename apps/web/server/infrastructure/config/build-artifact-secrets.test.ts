import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const webRoot = resolve(import.meta.dirname, '../../..')
const outputRoot = resolve(webRoot, '.output')

const injectedSecrets = {
  DATABASE_URL: 'postgresql://artifact-user:artifact-db-secret@artifact-db:5432/sauryctf',
  S3_ACCESS_KEY_ID: 'artifact-access-key-not-for-runtime',
  S3_SECRET_ACCESS_KEY: 'artifact-s3-secret-not-for-runtime',
  S3_BUCKET: 'artifact-private-bucket',
  S3_REGION: 'artifact-private-region',
  S3_ENDPOINT: 'https://artifact-private-endpoint.example.test',
}

describe('production build secret isolation', () => {
  it('does not embed database or S3 runtime configuration in publishable files', () => {
    execFileSync('pnpm', ['exec', 'nuxt', 'build'], {
      cwd: webRoot,
      env: { ...process.env, ...injectedSecrets },
      stdio: 'pipe',
      timeout: 120_000,
    })

    const files = walkFiles(outputRoot)
    expect(files.length).toBeGreaterThan(0)
    expect(files.some(file => file.includes('/.data/'))).toBe(false)

    for (const file of files) {
      const body = readFileSync(file)
      for (const secret of Object.values(injectedSecrets)) {
        expect(body.includes(Buffer.from(secret)), `${file} contains injected runtime configuration`).toBe(false)
      }
    }
  }, 130_000)
})

function walkFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return walkFiles(path)
    return statSync(path).isFile() ? [path] : []
  })
}
