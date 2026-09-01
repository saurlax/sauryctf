import type { Pool } from 'pg'
import type {
  ContentObject,
  ContentObjectRepository,
  ContentObjectStatus,
} from '../../domains/content/service'

interface ContentObjectRow {
  id: string
  storage_key: string
  sha256_digest: Buffer
  size_bytes: string | number
  media_type: string
  original_filename: string
  status: ContentObjectStatus
  created_by: string
  committed_at: Date | null
  created_at: Date
}

const contentObjectProjection = `
  id::text, storage_key, sha256_digest, size_bytes, media_type,
  original_filename, status::text, created_by::text, committed_at, created_at`

const qualifiedContentObjectProjection = `
  object.id::text, object.storage_key, object.sha256_digest, object.size_bytes,
  object.media_type, object.original_filename, object.status::text,
  object.created_by::text, object.committed_at, object.created_at`

export class PostgresContentObjectRepository implements ContentObjectRepository {
  constructor(private readonly pool: Pool) {}

  async registerTemporary(input: {
    storageKey: string
    sha256Digest: Buffer
    sizeBytes: number
    mediaType: string
    originalFilename: string
    createdBy: string
    createdAt: Date
  }): Promise<{ object: ContentObject, inserted: boolean }> {
    const result = await this.pool.query<ContentObjectRow & { inserted: boolean }>(`
      WITH inserted AS (
        INSERT INTO content_objects (
          storage_key, sha256_digest, size_bytes, media_type,
          original_filename, status, created_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, 'temporary', $6, $7)
        ON CONFLICT DO NOTHING
        RETURNING ${contentObjectProjection}
      )
      SELECT inserted.*, true AS inserted FROM inserted
      UNION ALL
      SELECT ${contentObjectProjection}, false AS inserted
      FROM content_objects
      WHERE sha256_digest = $2 AND size_bytes = $3 AND status <> 'deleted'
        AND NOT EXISTS (SELECT 1 FROM inserted)
      ORDER BY inserted DESC, created_at, id
      LIMIT 1`, [
      input.storageKey,
      input.sha256Digest,
      input.sizeBytes,
      input.mediaType,
      input.originalFilename,
      input.createdBy,
      input.createdAt,
    ])
    const row = result.rows[0]
    if (!row) throw new Error('Content object registration conflicted without a digest match')
    return { object: mapContentObject(row), inserted: row.inserted }
  }

  async findOwned(objectId: string, userId: string): Promise<ContentObject | null> {
    const result = await this.pool.query<ContentObjectRow>(`
      SELECT ${contentObjectProjection}
      FROM content_objects
      WHERE id = $1 AND created_by = $2`, [objectId, userId])
    return result.rows[0] ? mapContentObject(result.rows[0]) : null
  }

  async find(objectId: string): Promise<ContentObject | null> {
    const result = await this.pool.query<ContentObjectRow>(`
      SELECT ${contentObjectProjection}
      FROM content_objects
      WHERE id = $1`, [objectId])
    return result.rows[0] ? mapContentObject(result.rows[0]) : null
  }

  async commitTemporary(
    objectId: string,
    userId: string,
    sha256Digest: Buffer,
    committedAt: Date,
  ): Promise<ContentObject | null> {
    const result = await this.pool.query<ContentObjectRow>(`
      UPDATE content_objects
      SET status = 'committed', committed_at = $4
      WHERE id = $1 AND created_by = $2 AND sha256_digest = $3
        AND status = 'temporary'
      RETURNING ${contentObjectProjection}`, [objectId, userId, sha256Digest, committedAt])
    return result.rows[0] ? mapContentObject(result.rows[0]) : null
  }

  async claimGarbage(cutoff: Date, limit: number): Promise<ContentObject[]> {
    const result = await this.pool.query<ContentObjectRow>(`
      WITH candidates AS (
        SELECT object.id
        FROM content_objects AS object
        WHERE (
          (object.status = 'quarantined' AND object.deletion_claimed_at IS NOT NULL)
          OR (
            object.status = 'temporary'
            AND object.created_at <= $1
          )
          OR (
            object.status = 'committed'
            AND object.committed_at <= $1
          )
        )
        AND (
          (object.status = 'quarantined' AND object.deletion_claimed_at IS NOT NULL)
          OR (
            NOT EXISTS (SELECT 1 FROM content_references reference WHERE reference.content_object_id = object.id)
            AND NOT EXISTS (SELECT 1 FROM challenge_template_assets asset WHERE asset.content_object_id = object.id)
            AND NOT EXISTS (SELECT 1 FROM challenge_assets asset WHERE asset.content_object_id = object.id)
            AND NOT EXISTS (SELECT 1 FROM imports transfer WHERE transfer.package_object_id = object.id)
            AND NOT EXISTS (SELECT 1 FROM exports transfer WHERE transfer.package_object_id = object.id)
            AND NOT EXISTS (SELECT 1 FROM platform_settings setting WHERE setting.logo_object_id = object.id)
          )
        )
        ORDER BY CASE WHEN object.deletion_claimed_at IS NOT NULL THEN 0 ELSE 1 END,
          COALESCE(object.committed_at, object.created_at), object.id
        FOR UPDATE OF object SKIP LOCKED
        LIMIT $2
      )
      UPDATE content_objects AS object
      SET status = 'quarantined', deletion_claimed_at = clock_timestamp()
      FROM candidates
      WHERE object.id = candidates.id
      RETURNING ${qualifiedContentObjectProjection}`, [cutoff, limit])
    return result.rows.map(mapContentObject)
  }

  async markDeleted(objectId: string, storageKey: string): Promise<boolean> {
    const result = await this.pool.query(`
      UPDATE content_objects
      SET status = 'deleted', deletion_claimed_at = NULL
      WHERE id = $1 AND storage_key = $2
        AND status = 'quarantined' AND deletion_claimed_at IS NOT NULL`, [objectId, storageKey])
    return result.rowCount === 1
  }

  async confirmGarbageUnreferenced(objectId: string, storageKey: string): Promise<boolean> {
    const result = await this.pool.query<{ unreferenced: boolean }>(`
      WITH candidate AS MATERIALIZED (
        SELECT object.id, object.committed_at,
          NOT (
            EXISTS (SELECT 1 FROM content_references reference WHERE reference.content_object_id = object.id)
            OR EXISTS (SELECT 1 FROM challenge_template_assets asset WHERE asset.content_object_id = object.id)
            OR EXISTS (SELECT 1 FROM challenge_assets asset WHERE asset.content_object_id = object.id)
            OR EXISTS (SELECT 1 FROM imports transfer WHERE transfer.package_object_id = object.id)
            OR EXISTS (SELECT 1 FROM exports transfer WHERE transfer.package_object_id = object.id)
            OR EXISTS (SELECT 1 FROM platform_settings setting WHERE setting.logo_object_id = object.id)
          ) AS unreferenced
        FROM content_objects AS object
        WHERE object.id = $1 AND object.storage_key = $2
          AND object.status = 'quarantined' AND object.deletion_claimed_at IS NOT NULL
        FOR UPDATE OF object
      ), released AS (
        UPDATE content_objects AS object
        SET status = CASE WHEN candidate.committed_at IS NULL
            THEN 'temporary'::content_object_status ELSE 'committed'::content_object_status END,
            deletion_claimed_at = NULL
        FROM candidate
        WHERE object.id = candidate.id AND NOT candidate.unreferenced
      )
      SELECT unreferenced FROM candidate`, [objectId, storageKey])
    return result.rows[0]?.unreferenced === true
  }
}

function mapContentObject(row: ContentObjectRow): ContentObject {
  return {
    id: row.id,
    storageKey: row.storage_key,
    sha256Hex: row.sha256_digest.toString('hex'),
    sizeBytes: Number(row.size_bytes),
    mediaType: row.media_type,
    originalFilename: row.original_filename,
    status: row.status,
    createdBy: row.created_by,
    committedAt: row.committed_at,
    createdAt: row.created_at,
  }
}
