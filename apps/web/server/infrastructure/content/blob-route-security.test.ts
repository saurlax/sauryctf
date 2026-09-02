import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('Blob route security boundary', () => {
  it('has no generic Blob, storage, or content catch-all public API route', async () => {
    const apiDirectory = fileURLToPath(new URL('../../api/', import.meta.url))
    const entries = await readdir(apiDirectory, { recursive: true })
    const routes = entries.filter(entry => entry.endsWith('.ts'))

    expect(routes.filter(route => /(^|\/)(blob|storage)(\/|\.|$)/iu.test(route))).toEqual([])
    expect(routes.filter(route => route.startsWith('content/') && route.includes('[...'))).toEqual([])
  })
})
