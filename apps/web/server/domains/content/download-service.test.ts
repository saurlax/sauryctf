import { describe, expect, it, vi } from 'vitest'
import type { SessionSubject } from '../identity/repository'
import {
  ContentDownloadService,
  ContentDownloadServiceError,
  safeDownloadPresentation,
  type ContentDownloadRepository,
  type ContentDownloadUrlSigner,
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

function signer(): ContentDownloadUrlSigner & { signDownloadUrl: ReturnType<typeof vi.fn> } {
  return {
    signDownloadUrl: vi.fn(async () => 'https://objects.example.test/signed-download'),
  }
}

describe('authorized content downloads', () => {
  it('passes only global contest managers through the challenge management bypass', async () => {
    const downloads = repository()
    const urls = signer()
    const service = new ContentDownloadService(downloads, urls, () => new Date('2026-09-02T08:00:00.000Z'))

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
      filename: 'challenge.bin',
      mediaType: 'application/octet-stream',
    })
  })

  it('does not sign a URL when the repository hides an unauthorized reference', async () => {
    const urls = signer()
    const service = new ContentDownloadService(repository({
      findWriteupAttachment: vi.fn(async () => null),
    }), urls)

    await expect(service.writeupAttachment(
      player,
      '018f47a2-4ef8-7e2c-9c24-000000000204',
    )).rejects.toBeInstanceOf(ContentDownloadServiceError)
    expect(urls.signDownloadUrl).not.toHaveBeenCalled()
  })

  it('rejects unverified identities before resolving private content', async () => {
    const downloads = repository()
    const service = new ContentDownloadService(downloads, signer())

    await expect(service.challengeAsset(
      { ...player, emailVerified: false },
      '018f47a2-4ef8-7e2c-9c24-000000000205',
    )).rejects.toMatchObject({ code: 'identity.email_verification_required' })
    expect(downloads.findChallengeAsset).not.toHaveBeenCalled()
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
