import { describe, expect, it, vi } from 'vitest'
import type { SessionSubject } from '../identity/repository'
import {
  ContentDownloadService,
  ContentDownloadServiceError,
  safeDownloadPresentation,
  type ContentDownloadReader,
  type ContentDownloadRepository,
  type DownloadableContent,
} from './download-service'

const player: SessionSubject = {
  userId: '018f47a2-4ef8-7e2c-9c24-000000000201',
  username: 'DownloadPlayer',
  email: 'download-player@example.test',
  emailVerified: true,
  status: 'active',
  role: 'user',
  sessionVersion: 1,
  mustChangePassword: false,
}

const content: DownloadableContent = {
  storageKey: 'temporary/private-key',
  mediaType: 'application/octet-stream',
  originalFilename: 'original.bin',
  downloadFilename: 'challenge.bin',
}

function repository(overrides: Partial<ContentDownloadRepository> = {}): ContentDownloadRepository {
  return {
    findChallengeAsset: vi.fn(async () => content),
    findWriteupAttachment: vi.fn(async () => content),
    ...overrides,
  }
}

function reader(): ContentDownloadReader & { read: ReturnType<typeof vi.fn> } {
  return {
    read: vi.fn(async () => new Uint8Array([1, 2, 3])),
  }
}

describe('authorized content downloads', () => {
  it('passes only global contest managers through the challenge management bypass', async () => {
    const downloads = repository()
    const bodies = reader()
    const service = new ContentDownloadService(downloads, bodies, () => new Date('2026-09-02T08:00:00.000Z'))

    const grant = await service.challengeAsset(player, '018f47a2-4ef8-7e2c-9c24-000000000202')
    expect(downloads.findChallengeAsset).toHaveBeenCalledWith(
      player.userId,
      false,
      '018f47a2-4ef8-7e2c-9c24-000000000202',
      new Date('2026-09-02T08:00:00.000Z'),
    )
    await service.challengeAsset(
      { ...player, role: 'organizer' },
      '018f47a2-4ef8-7e2c-9c24-000000000203',
    )
    expect(downloads.findChallengeAsset).toHaveBeenLastCalledWith(
      player.userId,
      true,
      '018f47a2-4ef8-7e2c-9c24-000000000203',
      new Date('2026-09-02T08:00:00.000Z'),
    )
    expect(grant).toMatchObject({
      expiresAt: new Date('2026-09-02T08:01:00.000Z'),
      disposition: 'attachment',
      storageKey: content.storageKey,
      filename: 'challenge.bin',
      mediaType: 'application/octet-stream',
    })
    await expect(service.read(grant)).resolves.toEqual(new Uint8Array([1, 2, 3]))
    expect(bodies.read).toHaveBeenCalledWith(content.storageKey)
  })

  it('does not read storage when the repository hides an unauthorized reference', async () => {
    const bodies = reader()
    const service = new ContentDownloadService(repository({
      findWriteupAttachment: vi.fn(async () => null),
    }), bodies)

    await expect(service.writeupAttachment(
      player,
      '018f47a2-4ef8-7e2c-9c24-000000000204',
    )).rejects.toBeInstanceOf(ContentDownloadServiceError)
    expect(bodies.read).not.toHaveBeenCalled()
  })

  it('rejects unverified identities before resolving private content', async () => {
    const downloads = repository()
    const service = new ContentDownloadService(downloads, reader())

    await expect(service.challengeAsset(
      { ...player, emailVerified: false },
      '018f47a2-4ef8-7e2c-9c24-000000000205',
    )).rejects.toMatchObject({ code: 'identity.email_verification_required' })
    expect(downloads.findChallengeAsset).not.toHaveBeenCalled()
  })

  it('maps a missing authorized object body to the same not-found error', async () => {
    const service = new ContentDownloadService(repository(), { read: vi.fn(async () => null) })
    const grant = await service.challengeAsset(player, '018f47a2-4ef8-7e2c-9c24-000000000205')
    await expect(service.read(grant)).rejects.toMatchObject({ code: 'content.download_not_found' })
  })
})

describe('download presentation safety', () => {
  it('forces executable media to an attachment with an inert response type', () => {
    const presentation = safeDownloadPresentation(
      'text/html',
      '../../payload\r\nX-Injected: yes.html',
    )
    expect(presentation).toMatchObject({
      disposition: 'attachment',
      filename: 'payload__X-Injected: yes.html',
      mediaType: 'application/octet-stream',
    })
    expect(presentation.contentDisposition).toMatch(/^attachment;/u)
    expect(presentation.contentDisposition).not.toMatch(/[\r\n]/u)
  })

  it('allows a narrow raster-image allowlist to render inline', () => {
    const presentation = safeDownloadPresentation('image/png', '截图.png')
    expect(presentation).toMatchObject({
      disposition: 'inline',
      filename: '截图.png',
      mediaType: 'image/png',
    })
    expect(presentation.contentDisposition).toContain("filename*=UTF-8''")
  })
})
