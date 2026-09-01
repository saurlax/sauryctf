import { createApp, eventHandler, setResponseStatus, toWebHandler, type H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import {
  ContentObjectServiceError,
  maximumContentObjectBytes,
  type ContentObject,
} from '../../domains/content/service'
import { DisabledHumanVerificationProvider } from '../../domains/identity/human-verification'
import type { SessionSubject } from '../../domains/identity/repository'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from '../security/rate-limit'
import {
  handleCommitContentUpload,
  handleCreateContentUpload,
  readLimitedUpload,
  type ContentHttpDependencies,
} from './content-http'

const requestId = '018f47a2-4ef8-7e2c-9c24-000000000101'
const userId = '018f47a2-4ef8-7e2c-9c24-000000000102'
const objectId = '018f47a2-4ef8-7e2c-9c24-000000000103'
const session: AuthSessionData = {
  user_id: userId,
  session_version: 1,
  logged_in_at: '2026-09-02T04:00:00.000Z',
}
const subject: SessionSubject = {
  userId,
  username: 'ContentUser',
  email: 'content@example.test',
  emailVerified: true,
  status: 'active',
  role: 'user',
  sessionVersion: 1,
  mustChangePassword: false,
}
const temporary: ContentObject = {
  id: objectId,
  storageKey: 'temporary/internal-key',
  sha256Hex: 'a'.repeat(64),
  sizeBytes: 7,
  mediaType: 'text/plain',
  originalFilename: '附件.txt',
  status: 'temporary',
  createdBy: userId,
  committedAt: null,
  createdAt: new Date('2026-09-02T04:00:00.000Z'),
}

function dependencies(overrides: Partial<ContentHttpDependencies['content']> = {}): ContentHttpDependencies {
  return {
    identity: {
      identity: {} as ContentHttpDependencies['identity']['identity'],
      sessions: { validate: vi.fn(async () => subject) },
      humanVerification: new DisabledHumanVerificationProvider(),
      rateLimits: new MemoryRateLimitStore(),
      browserSession: { read: vi.fn(async () => session), replace: vi.fn(), clear: vi.fn() },
    },
    content: {
      uploadTemporary: vi.fn(async () => temporary),
      commitTemporary: vi.fn(async () => ({
        ...temporary,
        status: 'committed' as const,
        committedAt: new Date('2026-09-02T04:01:00.000Z'),
      })),
      ...overrides,
    },
    readUpload: vi.fn(async () => Buffer.from('content')),
  }
}

async function invoke(
  handler: (event: H3Event) => Promise<unknown>,
  request: Request,
) {
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

describe('content HTTP adapters', () => {
  it('rejects declared and streamed bodies above the upload limit', async () => {
    const declared = {
      node: {
        req: Object.assign([], {
          headers: { 'content-length': String(maximumContentObjectBytes + 1) },
        }),
      },
    } as unknown as H3Event
    await expect(readLimitedUpload(declared)).rejects.toMatchObject({
      statusCode: 413,
      data: { code: 'content.upload_too_large' },
    })

    const chunk = Buffer.alloc(1024 * 1024)
    const streamed = {
      node: {
        req: Object.assign(
          (async function* () {
            for (let index = 0; index < 65; index++) yield chunk
          })(),
          { headers: {} },
        ),
      },
    } as unknown as H3Event
    await expect(readLimitedUpload(streamed)).rejects.toMatchObject({
      statusCode: 413,
      data: { code: 'content.upload_too_large' },
    })
  })

  it('accepts a bounded binary upload without exposing its storage key', async () => {
    const deps = dependencies()
    const response = await invoke(
      event => handleCreateContentUpload(event, deps),
      new Request('https://ctf.example.test/api/content/uploads', {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          'x-content-filename': encodeURIComponent('附件.txt'),
        },
        body: 'content',
      }),
    )
    expect(response.status).toBe(201)
    const responseBody = await response.json()
    expect(responseBody).toMatchObject({
      id: objectId,
      sha256: 'a'.repeat(64),
      original_filename: '附件.txt',
      status: 'temporary',
    })
    expect(JSON.stringify(responseBody)).not.toContain('temporary/internal-key')
    expect(deps.content.uploadTemporary).toHaveBeenCalledWith(userId, expect.objectContaining({
      mediaType: 'text/plain',
      originalFilename: '附件.txt',
    }))
  })

  it('commits with the client digest and maps a mismatch to a stable conflict', async () => {
    const deps = dependencies()
    const response = await invoke(
      event => handleCommitContentUpload(event, objectId, deps),
      new Request(`https://ctf.example.test/api/content/uploads/${objectId}/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sha256: 'a'.repeat(64) }),
      }),
    )
    expect(response.status).toBe(200)
    expect(deps.content.commitTemporary).toHaveBeenCalledWith(userId, objectId, 'a'.repeat(64))

    const mismatch = dependencies({
      commitTemporary: vi.fn(async () => {
        throw new ContentObjectServiceError('content.digest_mismatch', '提交摘要与上传内容不一致')
      }),
    })
    const rejected = await invoke(
      event => handleCommitContentUpload(event, objectId, mismatch),
      new Request(`https://ctf.example.test/api/content/uploads/${objectId}/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sha256: 'b'.repeat(64) }),
      }),
    )
    expect(rejected.status).toBe(409)
    await expect(rejected.json()).resolves.toMatchObject({ error: { code: 'content.digest_mismatch' } })
  })
})
