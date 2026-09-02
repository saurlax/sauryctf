import { createApp, eventHandler, setResponseStatus, toWebHandler, type H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import type { SessionSubject } from '../../domains/identity/repository'
import type { PlatformSettingsRecord } from '../../domains/platform-settings/repository'
import { DisabledHumanVerificationProvider } from '../../domains/identity/human-verification'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from '../security/rate-limit'
import {
  handlePublicPlatformLogo,
  handlePublicPlatformSettings,
  handleUpdatePlatformSettings,
  type PlatformSettingsHttpDependencies,
} from './platform-settings-http'

const requestId = '018f47a2-4ef8-7e2c-9c24-000000000301'
const userId = '018f47a2-4ef8-7e2c-9c24-000000000302'
const session: AuthSessionData = {
  user_id: userId,
  session_version: 1,
  logged_in_at: '2026-09-02T00:00:00.000Z',
}
const admin: SessionSubject = {
  userId,
  username: 'SettingsAdmin',
  email: 'settings@example.test',
  emailVerified: true,
  status: 'active',
  role: 'admin',
  sessionVersion: 1,
  mustChangePassword: false,
}
const settings: PlatformSettingsRecord = {
  brandName: 'SauryCTF',
  logoObjectId: null,
  theme: 'system',
  defaultLocale: 'zh-CN',
  publicRegistrationEnabled: true,
  authenticationMode: 'password_only',
  version: 1,
  updatedBy: null,
  updatedAt: new Date('2026-09-02T00:00:00.000Z'),
}

function dependencies(subject = admin): PlatformSettingsHttpDependencies {
  return {
    identity: {
      identity: {} as PlatformSettingsHttpDependencies['identity']['identity'],
      sessions: { validate: vi.fn(async () => subject) },
      humanVerification: new DisabledHumanVerificationProvider(),
      rateLimits: new MemoryRateLimitStore(),
      browserSession: { read: vi.fn(async () => session), replace: vi.fn(), clear: vi.fn() },
    },
    settings: {
      readPublic: vi.fn(async () => settings),
      readManaged: vi.fn(async () => settings),
      update: vi.fn(async () => ({ ...settings, brandName: 'Arena', version: 2, updatedBy: userId })),
      readLogo: vi.fn(async () => ({
        body: new Uint8Array([1]),
        mediaType: 'image/png',
        filename: 'logo.png',
        sha256Hex: 'a'.repeat(64),
      })),
    },
  }
}

async function invoke(handler: (event: H3Event) => Promise<unknown>, request: Request) {
  const app = createApp()
  app.use(eventHandler(async (event) => {
    event.context.requestId = requestId
    try { return await handler(event) }
    catch (error) {
      const response = normalizeApiError(error, requestId)
      setResponseStatus(event, response.statusCode)
      return response.body
    }
  }))
  return toWebHandler(app)(request)
}

describe('platform settings HTTP adapters', () => {
  it('serves a cacheable public projection without deployment secrets', async () => {
    const response = await invoke(
      event => handlePublicPlatformSettings(event, dependencies()),
      new Request('https://ctf.example.test/api/platform/settings'),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"1"')
    expect(response.headers.get('cache-control')).toContain('must-revalidate')
    const body = await response.json() as Record<string, unknown>
    expect(body).toMatchObject({ settings: {
      brand_name: 'SauryCTF',
      logo_url: null,
      authentication_mode: 'password_only',
    } })
    expect(JSON.stringify(body)).not.toMatch(
      /session_secret|database_url|s3_secret_access_key|worker_credential/iu,
    )
  })

  it('serves a public raster logo with safe cache and filename headers', async () => {
    const deps = dependencies()
    deps.settings.readLogo = vi.fn(async () => ({
      body: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
      filename: '平台标识.png',
      sha256Hex: 'a'.repeat(64),
    }))
    const response = await invoke(
      event => handlePublicPlatformLogo(event, deps),
      new Request('https://ctf.example.test/api/platform/logo'),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-length')).toBe('3')
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''")
    expect(response.headers.get('etag')).toBe(`"${'a'.repeat(64)}"`)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('rejects OIDC and secret-shaped writes before the repository', async () => {
    const deps = dependencies()
    for (const payload of [
      { authentication_mode: 'oidc_only', reason: 'unsupported auth mode' },
      { brand_name: 'Arena', NUXT_SESSION_PASSWORD: 'secret', reason: 'unknown secret key' },
    ]) {
      const response = await invoke(
        event => handleUpdatePlatformSettings(event, deps),
        new Request('https://ctf.example.test/api/admin/platform/settings', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'if-match': '"1"' },
          body: JSON.stringify(payload),
        }),
      )
      expect(response.status).toBe(400)
    }
    expect(deps.settings.update).not.toHaveBeenCalled()
  })

  it('passes a valid typed update with optimistic concurrency', async () => {
    const deps = dependencies()
    const response = await invoke(
      event => handleUpdatePlatformSettings(event, deps),
      new Request('https://ctf.example.test/api/admin/platform/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'if-match': '"1"' },
        body: JSON.stringify({ brand_name: 'Arena', reason: 'refresh public brand' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"2"')
    expect(deps.settings.update).toHaveBeenCalledWith(admin, expect.objectContaining({
      expectedVersion: 1,
      brandName: 'Arena',
    }))
  })
})
