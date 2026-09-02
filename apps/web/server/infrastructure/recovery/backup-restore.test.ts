import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ContentObjectService } from '../../domains/content/service'
import { ScoreboardViewService } from '../../domains/scoreboards/view-service'
import { ContestScoringReplayService } from '../../domains/submissions/scoring-replay'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { PostgresContentObjectRepository } from '../db/content-object-repository'
import { PostgresScoreboardViewRepository } from '../db/scoreboard-view-repository'
import { PostgresScoringReplayRepository } from '../db/scoring-replay-repository'
import {
  S3ContentObjectStore,
  type S3ContentObjectStoreConfig,
} from '../storage/s3-content-object-store'
import { createBlobStorage } from '@nuxthub/core/blob'
import { createDriver as createFileSystemDriver } from '@nuxthub/core/blob/drivers/fs'
import { NuxtHubContentObjectStore } from '../storage/nuxthub-content-object-store'

const phase = process.env.BACKUP_RECOVERY_PHASE
const databaseUrl = process.env.TEST_DATABASE_URL
const s3Endpoint = process.env.TEST_S3_ENDPOINT
const blobDirectory = process.env.TEST_BLOB_DIR
const dependenciesConfigured = Boolean(databaseUrl && (s3Endpoint || blobDirectory))
const describeSeed = phase === 'seed' && dependenciesConfigured ? describe : describe.skip
const describeRestore = phase === 'restore' && dependenciesConfigured ? describe : describe.skip
const fixtureSlug = 'backup-recovery-contest'
const markerKey = 'backup-recovery-authoritative-cutoff'
const objectFilename = 'backup-recovery-attachment.bin'
const s3Config: S3ContentObjectStoreConfig = {
  endpoint: s3Endpoint!,
  region: process.env.TEST_S3_REGION ?? 'us-east-1',
  bucket: process.env.TEST_S3_BUCKET ?? 'sauryctf',
  accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? 'sauryctf',
  secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'sauryctf-backup-secret',
  forcePathStyle: true,
}

describeSeed('backup recovery source fixture', () => {
  let database: PostgresTestDatabase
  let store: NuxtHubContentObjectStore

  beforeAll(() => {
    database = createPostgresTestDatabase({
      connectionString: databaseUrl!,
      applicationName: 'sauryctf-backup-source',
      maxConnections: 8,
    })
    store = createStore()
  })

  afterAll(async () => {
    store?.close()
    if (database) await database.close()
  })

  it('creates a consistent PostgreSQL and object-storage recovery point', async () => {
    const now = new Date()
    const operator = await database.executor.query<{ id: string }>(`
      INSERT INTO users
        (username, username_normalized, email, email_normalized, email_verified_at)
      VALUES ('BackupOperator', 'backupoperator',
              'backup-operator@example.test', 'backup-operator@example.test', $1)
      RETURNING id`, [now])
    const operatorId = operator.rows[0]!.id
    const player = await database.executor.query<{ id: string }>(`
      INSERT INTO users
        (username, username_normalized, email, email_normalized, email_verified_at)
      VALUES ('BackupPlayer', 'backupplayer',
              'backup-player@example.test', 'backup-player@example.test', $1)
      RETURNING id`, [now])
    const playerId = player.rows[0]!.id

    const teamConnection = await database.connect()
    let teamId: string
    try {
      await teamConnection.query('BEGIN')
      const team = await teamConnection.query<{ id: string }>(`
        INSERT INTO teams (name, name_normalized, created_by)
        VALUES ('Backup Recovery Team', 'backup recovery team', $1)
        RETURNING id`, [playerId])
      teamId = team.rows[0]!.id
      await teamConnection.query(`
        INSERT INTO team_members (team_id, user_id, role)
        VALUES ($1, $2, 'captain')`, [teamId, playerId])
      await teamConnection.query('COMMIT')
    }
    catch (error) {
      await teamConnection.query('ROLLBACK')
      throw error
    }
    finally {
      teamConnection.release()
    }

    const contest = await database.executor.query<{ id: string }>(`
      INSERT INTO contests
        (title, slug, description, publication_status, visibility,
         start_at, end_at, published_at, created_by)
      VALUES ('Backup Recovery Contest', $1, 'Backup and restore acceptance fixture',
              'draft', 'public', $2, $3, NULL, $4)
      RETURNING id`, [
      fixtureSlug,
      new Date(now.getTime() - 60 * 60_000),
      new Date(now.getTime() + 60 * 60_000),
      operatorId,
    ])
    const contestId = contest.rows[0]!.id
    const participation = await database.executor.query<{ id: string }>(`
      INSERT INTO participations
        (contest_id, team_id, status, registered_by, reviewed_by, reviewed_at)
      VALUES ($1, $2, 'accepted', $3, $4, $5)
      RETURNING id`, [contestId, teamId, playerId, operatorId, now])
    const participationId = participation.rows[0]!.id

    const content = new ContentObjectService(
      new PostgresContentObjectRepository(database.executor),
      store,
      () => now,
    )
    const attachmentBody = Buffer.from(`backup-recovery-object-${randomUUID()}`)
    const attachmentDigest = createHash('sha256').update(attachmentBody).digest('hex')
    const temporary = await content.uploadTemporary(operatorId, {
      body: attachmentBody,
      mediaType: 'application/octet-stream',
      originalFilename: objectFilename,
    })
    const committed = await content.commitTemporary(operatorId, temporary.id, attachmentDigest)

    const template = await database.executor.query<{ id: string }>(`
      INSERT INTO challenge_templates (name, slug, created_by, latest_version)
      VALUES ('Backup Recovery Challenge', 'backup-recovery-challenge', $1, 1)
      RETURNING id`, [operatorId])
    const templateId = template.rows[0]!.id
    const version = await database.executor.query<{ id: string }>(`
      INSERT INTO challenge_template_versions
        (template_id, version_number, title, category, description,
         flag_policy, scoring_policy, instance_policy, created_by)
      VALUES ($1, 1, 'Backup Recovery Challenge', 'misc', 'Restore this challenge',
              '{"type":"static","digest":"masked"}',
              '{"type":"fixed-v1","points":500}', '{"type":"none"}', $2)
      RETURNING id`, [templateId, operatorId])
    const challenge = await database.executor.query<{ id: string }>(`
      INSERT INTO contest_challenges
        (contest_id, source_template_id, source_version_id, title, category,
         description, flag_policy, scoring_policy, instance_policy, enabled, publish_at)
      VALUES ($1, $2, $3, 'Backup Recovery Challenge', 'misc', 'Restore this challenge',
              '{"type":"static","digest":"masked"}',
              '{"type":"fixed-v1","points":500}', '{"type":"none"}', true, $4)
      RETURNING id`, [contestId, templateId, version.rows[0]!.id, now])
    const challengeId = challenge.rows[0]!.id
    await database.executor.query(`
      INSERT INTO challenge_assets
        (contest_challenge_id, content_object_id, display_name, sort_order)
      VALUES ($1, $2, $3, 0)`, [challengeId, committed.id, objectFilename])
    await database.executor.query(`
      UPDATE contests
      SET publication_status = 'published', published_at = $2
      WHERE id = $1`, [contestId, now])

    const submission = await database.executor.query<{ id: string }>(`
      INSERT INTO submissions
        (contest_id, contest_challenge_id, participation_id, user_id, mode,
         result, answer_digest, answer_ciphertext, request_id, submitted_at)
      VALUES ($1, $2, $3, $4, 'official', 'correct', $5, $6, $7, $8)
      RETURNING id`, [
      contestId,
      challengeId,
      participationId,
      playerId,
      randomBytes(32),
      randomBytes(33),
      randomUUID(),
      now,
    ])
    await database.executor.query(`
      INSERT INTO solves
        (submission_id, contest_id, contest_challenge_id, participation_id,
         mode, awarded_score, solve_order, solved_at)
      VALUES ($1, $2, $3, $4, 'official', 500, 1, $5)`, [
      submission.rows[0]!.id,
      contestId,
      challengeId,
      participationId,
      now,
    ])
    await database.executor.query(`
      INSERT INTO scoreboard_versions (contest_id, version, updated_at)
      VALUES ($1, 1, $2)`, [contestId, now])

    const scoreboards = new ScoreboardViewService(
      new PostgresScoreboardViewRepository(database.executor),
      new ContestScoringReplayService(new PostgresScoringReplayRepository(database.executor)),
      undefined,
      () => now,
    )
    const sourceBoard = await scoreboards.read({
      contestId,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'overall' },
    })
    expect(sourceBoard.board.rows).toEqual([
      expect.objectContaining({ participationId, totalPoints: 500, officialSolveCount: 1 }),
    ])

    const cutoff = new Date()
    await database.executor.query(`
      INSERT INTO domain_outbox
        (aggregate_type, aggregate_id, event_type, dedupe_key, payload, occurred_at, available_at)
      VALUES ('contest', $1, 'backup.recovery_point', $2,
              jsonb_build_object('content_object_id', $3::uuid, 'sha256', $4::text), $5, $5)`, [
      contestId,
      markerKey,
      committed.id,
      attachmentDigest,
      cutoff,
    ])

    console.log(`BACKUP_SEED ${JSON.stringify({
      contest_id: contestId,
      content_object_id: committed.id,
      storage_key: committed.storageKey,
      sha256: attachmentDigest,
      cutoff_at: cutoff.toISOString(),
    })}`)
  }, 30_000)
})

describeRestore('isolated backup restore verification', () => {
  let database: PostgresTestDatabase
  let store: NuxtHubContentObjectStore

  beforeAll(() => {
    database = createPostgresTestDatabase({
      connectionString: databaseUrl!,
      applicationName: 'sauryctf-backup-restore',
      maxConnections: 8,
    })
    store = createStore()
  })

  afterAll(async () => {
    store?.close()
    if (database) await database.close()
  })

  it('restores authoritative facts, verifies attachment digest and rebuilds the scoreboard', async () => {
    const fixture = await database.executor.query<{
      contest_id: string
      participation_id: string
      content_object_id: string
      storage_key: string
      sha256_hex: string
      size_bytes: string
      marker_at: Date
    }>(`
      SELECT contest.id AS contest_id, participation.id AS participation_id,
             object.id AS content_object_id, object.storage_key,
             encode(object.sha256_digest, 'hex') AS sha256_hex,
             object.size_bytes::text,
             marker.occurred_at AS marker_at
      FROM contests AS contest
      JOIN participations AS participation ON participation.contest_id = contest.id
      JOIN contest_challenges AS challenge ON challenge.contest_id = contest.id
      JOIN challenge_assets AS asset ON asset.contest_challenge_id = challenge.id
      JOIN content_objects AS object ON object.id = asset.content_object_id
      JOIN domain_outbox AS marker ON marker.aggregate_id = contest.id AND marker.dedupe_key = $2
      WHERE contest.slug = $1`, [fixtureSlug, markerKey])
    expect(fixture.rows).toHaveLength(1)
    const restored = fixture.rows[0]!
    const body = await store.read(restored.storage_key)
    expect(body).not.toBeNull()
    expect(String(body!.byteLength)).toBe(restored.size_bytes)
    expect(createHash('sha256').update(body!).digest('hex')).toBe(restored.sha256_hex)
    await expect(store.stat(restored.storage_key)).resolves.toMatchObject({
      sizeBytes: Number(restored.size_bytes),
      mediaType: 'application/octet-stream',
      sha256Hex: restored.sha256_hex,
    })

    const solveCount = await database.executor.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM solves
      WHERE contest_id = $1 AND mode = 'official'`, [restored.contest_id])
    expect(solveCount.rows[0]?.count).toBe(1)
    await database.executor.query(`DELETE FROM scoreboard_snapshots WHERE contest_id = $1`, [restored.contest_id])

    const scoreboards = new ScoreboardViewService(
      new PostgresScoreboardViewRepository(database.executor),
      new ContestScoringReplayService(new PostgresScoringReplayRepository(database.executor)),
    )
    const rebuilt = await scoreboards.read({
      contestId: restored.contest_id,
      view: 'public',
      viewerRole: 'user',
      scope: { type: 'overall' },
    })
    expect(rebuilt).toMatchObject({ version: 1, freshness: 'current' })
    expect(rebuilt.board.rows).toEqual([
      expect.objectContaining({
        participationId: restored.participation_id,
        totalPoints: 500,
        officialSolveCount: 1,
      }),
    ])
    const rebuiltSnapshots = await database.executor.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM scoreboard_snapshots
      WHERE contest_id = $1 AND view = 'public' AND version = 1`, [restored.contest_id])
    expect(rebuiltSnapshots.rows[0]?.count).toBe(1)

    console.log(`BACKUP_RESTORE ${JSON.stringify({
      contest_id: restored.contest_id,
      content_object_id: restored.content_object_id,
      sha256: restored.sha256_hex,
      marker_at: restored.marker_at.toISOString(),
      scoreboard_version: rebuilt.version,
      total_points: rebuilt.board.rows[0]!.totalPoints,
    })}`)
  }, 30_000)
})

function createStore(): NuxtHubContentObjectStore {
  if (blobDirectory) {
    return new NuxtHubContentObjectStore(createBlobStorage(createFileSystemDriver({ dir: blobDirectory })))
  }
  return new S3ContentObjectStore(s3Config)
}
