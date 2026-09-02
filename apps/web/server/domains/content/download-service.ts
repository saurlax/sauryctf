import { hasIdentityCapability, identityCapability, requireIdentityCapability } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'

export const contentDownloadUrlLifetimeSeconds = 60

export interface DownloadableContent {
  storageKey: string
  mediaType: string
  originalFilename: string
  downloadFilename: string
}

export interface ContentDownloadRepository {
  findChallengeAsset(
    actorId: string,
    canManageContests: boolean,
    assetId: string,
    at: Date,
  ): Promise<DownloadableContent | null>
  findWriteupAttachment(
    actorId: string,
    canJudgeContests: boolean,
    referenceId: string,
  ): Promise<DownloadableContent | null>
}

export interface ContentDownloadReader {
  read(storageKey: string): Promise<Uint8Array | null>
}

export interface ContentDownloadGrant {
  storageKey: string
  expiresAt: Date
  disposition: 'inline' | 'attachment'
  contentDisposition: string
  filename: string
  mediaType: string
}

export class ContentDownloadServiceError extends Error {
  constructor(readonly code: 'content.download_not_found') {
    super('内容不存在或当前账号无权下载')
    this.name = 'ContentDownloadServiceError'
  }
}

export class ContentDownloadService {
  constructor(
    private readonly repository: ContentDownloadRepository,
    private readonly reader: ContentDownloadReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async challengeAsset(actor: SessionSubject, assetId: string): Promise<ContentDownloadGrant> {
    requireIdentityCapability(actor, identityCapability.contentDownload)
    const at = this.now()
    const content = await this.repository.findChallengeAsset(
      actor.userId,
      hasIdentityCapability(actor, identityCapability.contestManage),
      assetId,
      at,
    )
    return this.grant(content, at)
  }

  async writeupAttachment(actor: SessionSubject, referenceId: string): Promise<ContentDownloadGrant> {
    requireIdentityCapability(actor, identityCapability.contentDownload)
    const at = this.now()
    const content = await this.repository.findWriteupAttachment(
      actor.userId,
      hasIdentityCapability(actor, identityCapability.contestJudge),
      referenceId,
    )
    return this.grant(content, at)
  }

  async read(grant: ContentDownloadGrant): Promise<Uint8Array> {
    const body = await this.reader.read(grant.storageKey)
    if (!body) throw new ContentDownloadServiceError('content.download_not_found')
    return body
  }

  private async grant(
    content: DownloadableContent | null,
    issuedAt: Date,
  ): Promise<ContentDownloadGrant> {
    if (!content) throw new ContentDownloadServiceError('content.download_not_found')
    const presentation = safeDownloadPresentation(content.mediaType, content.downloadFilename)
    return {
      storageKey: content.storageKey,
      expiresAt: new Date(issuedAt.getTime() + contentDownloadUrlLifetimeSeconds * 1000),
      disposition: presentation.disposition,
      contentDisposition: presentation.contentDisposition,
      filename: presentation.filename,
      mediaType: presentation.mediaType,
    }
  }
}

const inlineMediaTypes = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

const dangerousMediaTypes = new Set([
  'application/javascript',
  'application/xhtml+xml',
  'application/xml',
  'image/svg+xml',
  'text/css',
  'text/html',
  'text/javascript',
  'text/xml',
])

export function safeDownloadPresentation(mediaType: string, filename: string): {
  contentDisposition: string
  disposition: 'inline' | 'attachment'
  filename: string
  mediaType: string
} {
  const normalizedType = mediaType.toLowerCase()
  const disposition = inlineMediaTypes.has(normalizedType) ? 'inline' : 'attachment'
  const safeFilename = safeDownloadFilename(filename)
  return {
    contentDisposition: contentDisposition(disposition, safeFilename),
    disposition,
    filename: safeFilename,
    mediaType: dangerousMediaTypes.has(normalizedType) ? 'application/octet-stream' : normalizedType,
  }
}

function safeDownloadFilename(value: string): string {
  const basename = value.normalize('NFC').replaceAll('\\', '/').split('/').at(-1) ?? ''
  const cleaned = basename.replace(/[\u0000-\u001f\u007f]/gu, '_').trim()
  const source = cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'download'
  let bounded = ''
  for (const character of source) {
    if (bounded.length + character.length > 255) break
    bounded += character
  }
  return bounded
}

function contentDisposition(disposition: 'inline' | 'attachment', filename: string): string {
  const fallback = filename
    .replace(/[^\u0020-\u007e]/gu, '_')
    .replaceAll('\\', '_')
    .replaceAll('"', '_')
    .slice(0, 150) || 'download'
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/gu, character => (
    `%${character.codePointAt(0)!.toString(16).toUpperCase()}`
  ))
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
