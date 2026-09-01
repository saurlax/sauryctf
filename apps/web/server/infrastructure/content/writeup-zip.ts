import { createHash } from 'node:crypto'
import { PassThrough } from 'node:stream'
import archiver from 'archiver'
import type { ContentObjectStore } from '../../domains/content/service'
import {
  WriteupArchiveContentUnavailableError,
  type WriteupArchiveBuilder,
} from '../../domains/writeups/service'
import type {
  WriteupExportAttachment,
  WriteupExportSnapshot,
} from '../../domains/writeups/repository'

type ContentReader = Pick<ContentObjectStore, 'read'>

interface PreparedAttachment {
  path: string
  body: Uint8Array
  attachment: WriteupExportAttachment
}

export class ZipWriteupArchiveBuilder implements WriteupArchiveBuilder {
  constructor(private readonly content: ContentReader) {}

  async build(snapshot: WriteupExportSnapshot, exportedAt: Date): Promise<Uint8Array> {
    const manifestEntries: Array<Record<string, unknown>> = []
    const prepared: PreparedAttachment[] = []
    for (const entry of snapshot.entries) {
      const teamDirectory = `teams/${safePathComponent(entry.teamName, 'team')}-${entry.teamId}`
      const bodyPath = `${teamDirectory}/writeup.md`
      const attachments: Array<Record<string, unknown>> = []
      for (const attachment of entry.attachments) {
        const path = `${teamDirectory}/attachments/${attachment.referenceId}-${safePathComponent(attachment.filename, 'attachment')}`
        const body = await this.content.read(attachment.storageKey)
        if (!body
          || body.byteLength !== attachment.sizeBytes
          || createHash('sha256').update(body).digest('hex') !== attachment.sha256Hex) {
          throw new WriteupArchiveContentUnavailableError()
        }
        prepared.push({ path, body, attachment })
        attachments.push({
          reference_id: attachment.referenceId,
          content_object_id: attachment.contentObjectId,
          path,
          filename: attachment.filename,
          media_type: attachment.mediaType,
          size_bytes: attachment.sizeBytes,
          sha256: attachment.sha256Hex,
        })
      }
      manifestEntries.push({
        writeup_id: entry.writeupId,
        participation_id: entry.participationId,
        team_id: entry.teamId,
        team_name: entry.teamName,
        submitted_version: entry.versionNumber,
        submitted_at: entry.submittedAt.toISOString(),
        body_path: bodyPath,
        attachments,
      })
    }

    const archive = archiver('zip', { zlib: { level: 9 } })
    const output = new PassThrough()
    archive.on('error', error => output.destroy(error))
    archive.on('warning', error => output.destroy(error))
    archive.pipe(output)
    const completed = collect(output)
    archive.append(`${JSON.stringify({
      format: 'sauryctf.writeups.v1',
      contest_id: snapshot.contestId,
      contest_title: snapshot.contestTitle,
      exported_at: exportedAt.toISOString(),
      writeups: manifestEntries,
    }, null, 2)}\n`, { name: 'manifest.json' })
    for (const entry of snapshot.entries) {
      const teamDirectory = `teams/${safePathComponent(entry.teamName, 'team')}-${entry.teamId}`
      archive.append(entry.body, { name: `${teamDirectory}/writeup.md` })
    }
    for (const attachment of prepared) {
      archive.append(Buffer.from(attachment.body), { name: attachment.path })
    }
    await archive.finalize()
    return completed
  }
}

async function collect(stream: PassThrough): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function safePathComponent(value: string, fallback: string): string {
  const normalized = value.normalize('NFC')
    .replaceAll('\\', '_')
    .replaceAll('/', '_')
    .replace(/[\u0000-\u001f\u007f:*?"<>|]/gu, '_')
    .replace(/\.{2,}/gu, '_')
    .trim()
  const source = normalized && normalized !== '.' && normalized !== '..' ? normalized : fallback
  let bounded = ''
  for (const character of source) {
    if (bounded.length + character.length > 120) break
    bounded += character
  }
  return bounded
}
