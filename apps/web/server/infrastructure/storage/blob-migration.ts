import { createHash } from 'node:crypto'
import type { DatabaseExecutor } from '../db/executor'
import type { NuxtHubContentObjectStore } from './nuxthub-content-object-store'

export interface BlobMigrationEntry {
  storageKey: string
  sizeBytes: number
  sha256Hex: string
  mediaType: string
}

export type BlobMigrationStore = Pick<NuxtHubContentObjectStore, 'put' | 'read' | 'stat'>

export class BlobMigrationError extends Error {
  constructor(
    readonly code: 'manifest_invalid' | 'source_missing' | 'source_mismatch' | 'target_mismatch',
    readonly storageKey: string,
  ) {
    super(`Blob migration ${code}: ${storageKey}`)
    this.name = 'BlobMigrationError'
  }
}

export async function loadCommittedBlobManifest(
  database: Pick<DatabaseExecutor, 'query'>,
): Promise<BlobMigrationEntry[]> {
  const result = await database.query<{
    storage_key: string
    size_bytes: string
    sha256_hex: string
    media_type: string
  }>(`
    SELECT storage_key, size_bytes::text, encode(sha256_digest, 'hex') AS sha256_hex, media_type
    FROM content_objects
    WHERE status = 'committed'
    ORDER BY storage_key
  `)
  return validateManifest(result.rows.map(row => ({
    storageKey: row.storage_key,
    sizeBytes: Number(row.size_bytes),
    sha256Hex: row.sha256_hex,
    mediaType: row.media_type,
  })))
}

export async function migrateCommittedBlobs(
  manifest: readonly BlobMigrationEntry[],
  source: BlobMigrationStore,
  target: BlobMigrationStore,
): Promise<{ copied: number, skipped: number, total: number, readyToSwitch: true }> {
  const entries = validateManifest(manifest)
  let copied = 0
  let skipped = 0
  for (const entry of entries) {
    const targetState = await inspectObject(target, entry)
    if (targetState === 'valid') {
      skipped++
      continue
    }
    if (targetState === 'mismatch') throw new BlobMigrationError('target_mismatch', entry.storageKey)

    const sourceState = await inspectObject(source, entry)
    if (sourceState === 'missing') throw new BlobMigrationError('source_missing', entry.storageKey)
    if (sourceState === 'mismatch') throw new BlobMigrationError('source_mismatch', entry.storageKey)
    const body = await source.read(entry.storageKey)
    if (!body) throw new BlobMigrationError('source_missing', entry.storageKey)
    await target.put({
      storageKey: entry.storageKey,
      body,
      sizeBytes: entry.sizeBytes,
      sha256Hex: entry.sha256Hex,
      mediaType: entry.mediaType,
    })
    if (await inspectObject(target, entry) !== 'valid') {
      throw new BlobMigrationError('target_mismatch', entry.storageKey)
    }
    copied++
  }
  await assertBlobMigrationComplete(entries, target)
  return { copied, skipped, total: entries.length, readyToSwitch: true }
}

export async function assertBlobMigrationComplete(
  manifest: readonly BlobMigrationEntry[],
  target: BlobMigrationStore,
): Promise<void> {
  for (const entry of validateManifest(manifest)) {
    if (await inspectObject(target, entry) !== 'valid') {
      throw new BlobMigrationError('target_mismatch', entry.storageKey)
    }
  }
}

function validateManifest(manifest: readonly BlobMigrationEntry[]): BlobMigrationEntry[] {
  const keys = new Set<string>()
  return manifest.map((entry) => {
    if (!entry.storageKey || keys.has(entry.storageKey)
      || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0
      || !/^[a-f0-9]{64}$/u.test(entry.sha256Hex)
      || !entry.mediaType) {
      throw new BlobMigrationError('manifest_invalid', entry.storageKey)
    }
    keys.add(entry.storageKey)
    return { ...entry }
  })
}

async function inspectObject(
  store: BlobMigrationStore,
  entry: BlobMigrationEntry,
): Promise<'missing' | 'mismatch' | 'valid'> {
  const metadata = await store.stat(entry.storageKey)
  if (!metadata) return 'missing'
  if (metadata.sizeBytes !== entry.sizeBytes
    || metadata.sha256Hex !== entry.sha256Hex
    || metadata.mediaType !== entry.mediaType) return 'mismatch'
  const body = await store.read(entry.storageKey)
  if (!body) return 'missing'
  return body.byteLength === entry.sizeBytes
    && createHash('sha256').update(body).digest('hex') === entry.sha256Hex
    ? 'valid'
    : 'mismatch'
}
