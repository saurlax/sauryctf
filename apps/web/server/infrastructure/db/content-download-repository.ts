import type { Pool } from 'pg'
import type {
  ContentDownloadRepository,
  DownloadableContent,
} from '../../domains/content/download-service'

interface DownloadableContentRow {
  storage_key: string
  media_type: string
  original_filename: string
  download_filename: string
}

const projection = `
  object.storage_key, object.media_type, object.original_filename`

export class PostgresContentDownloadRepository implements ContentDownloadRepository {
  constructor(private readonly pool: Pool) {}

  async findChallengeAsset(
    actorId: string,
    canManageContests: boolean,
    assetId: string,
    at: Date,
  ): Promise<DownloadableContent | null> {
    const result = await this.pool.query<DownloadableContentRow>(`
      SELECT ${projection}, asset.display_name AS download_filename
      FROM challenge_assets asset
      JOIN contest_challenges challenge ON challenge.id = asset.contest_challenge_id
      JOIN contests contest ON contest.id = challenge.contest_id
      JOIN content_objects object ON object.id = asset.content_object_id
      WHERE asset.id = $2
        AND object.status = 'committed'
        AND object.committed_at IS NOT NULL
        AND (
          $3::boolean
          OR (
            contest.publication_status IN ('published', 'archived')
            AND challenge.enabled = true
            AND (contest.publication_status = 'archived' OR contest.start_at <= $4)
            AND (challenge.publish_at IS NULL OR challenge.publish_at <= $4)
            AND EXISTS (
              SELECT 1
              FROM team_members member
              JOIN participations participation
                ON participation.team_id = member.team_id
               AND participation.contest_id = contest.id
               AND participation.status = 'accepted'
              WHERE member.user_id = $1
            )
          )
        )
      LIMIT 1`, [actorId, assetId, canManageContests, at])
    return result.rows[0] ? mapDownloadableContent(result.rows[0]) : null
  }

  async findWriteupAttachment(
    actorId: string,
    canJudgeContests: boolean,
    referenceId: string,
  ): Promise<DownloadableContent | null> {
    const result = await this.pool.query<DownloadableContentRow>(`
      SELECT ${projection}, object.original_filename AS download_filename
      FROM content_references reference
      JOIN content_objects object ON object.id = reference.content_object_id
      JOIN writeup_versions writeup_version ON writeup_version.id = reference.writeup_version_id
      JOIN writeups writeup ON writeup.id = writeup_version.writeup_id
      JOIN participations participation ON participation.id = writeup.participation_id
      WHERE reference.id = $2
        AND reference.reference_type = 'writeup_attachment'
        AND object.status = 'committed'
        AND object.committed_at IS NOT NULL
        AND (
          $3::boolean
          OR EXISTS (
            SELECT 1 FROM team_members member
            WHERE member.team_id = participation.team_id
              AND member.user_id = $1
          )
        )
      LIMIT 1`, [actorId, referenceId, canJudgeContests])
    return result.rows[0] ? mapDownloadableContent(result.rows[0]) : null
  }
}

function mapDownloadableContent(row: DownloadableContentRow): DownloadableContent {
  return {
    storageKey: row.storage_key,
    mediaType: row.media_type,
    originalFilename: row.original_filename,
    downloadFilename: row.download_filename,
  }
}
