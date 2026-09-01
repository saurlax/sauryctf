import { createHash, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ContentObjectService } from '../../domains/content/service'
import { createDatabaseClient, type DatabaseClient } from '../db/client'
import { PostgresContentObjectRepository } from '../db/content-object-repository'
import { runMigrations } from '../db/migrate'
import {
  S3ContentObjectStore,
  type S3ContentObjectStoreConfig,
} from '../storage/s3-content-object-store'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const s3Endpoint = process.env.TEST_S3_ENDPOINT
const describeWithDependencies = adminConnectionString && s3Endpoint ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName(): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected test database name')
  return `"${databaseName}"`
}

describeWithDependencies('PostgreSQL and S3 content lifecycle', () => {
  let admin: Client
  let database: DatabaseClient
  let userId: string
  const storageKeys = new Set<string>()
  const s3Config: S3ContentObjectStoreConfig = {
    endpoint: s3Endpoint!,
    region: process.env.TEST_S3_REGION ?? 'us-east-1',
    bucket: process.env.TEST_S3_BUCKET ?? 'sauryctf',
    accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? 'sauryctf',
    secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'sauryctf-dev-secret',
    forcePathStyle: true,
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 4 })
    await runMigrations(database)
    const user = await database.pool.query<{ id: string }>(`
      INSERT INTO users (username, username_normalized, email, email_normalized)
      VALUES ('ContentLifecycle', 'contentlifecycle', 'content-lifecycle@example.test', 'content-lifecycle@example.test')
      RETURNING id`)
    userId = user.rows[0]!.id
  })

  afterAll(async () => {
    const store = new S3ContentObjectStore(s3Config)
    for (const key of storageKeys) await store.delete(key)
    store.close()
    if (database) await database.pool.end()
    if (admin) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [databaseName],
      )
      await admin.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName()}`)
      await admin.end()
    }
  })

  it('keeps committed bytes available after control-plane services are recreated', async () => {
    const now = new Date('2026-09-02T04:00:00.000Z')
    const firstStore = new S3ContentObjectStore(s3Config)
    const firstService = new ContentObjectService(
      new PostgresContentObjectRepository(database.pool),
      firstStore,
      () => now,
    )
    const body = Buffer.from('S3 survives a control-plane restart')
    const temporary = await firstService.uploadTemporary(userId, {
      body,
      mediaType: 'application/octet-stream',
      originalFilename: 'restart.bin',
    })
    storageKeys.add(temporary.storageKey)
    firstStore.close()

    const restartedStore = new S3ContentObjectStore(s3Config)
    const restartedService = new ContentObjectService(
      new PostgresContentObjectRepository(database.pool),
      restartedStore,
      () => now,
    )
    const committed = await restartedService.commitTemporary(
      userId,
      temporary.id,
      createHash('sha256').update(body).digest('hex'),
    )
    expect(committed.status).toBe('committed')
    expect(Buffer.from((await restartedStore.read(committed.storageKey))!)).toEqual(body)

    const redundantKey = `temporary/${randomUUID()}`
    const deduplicatingService = new ContentObjectService(
      new PostgresContentObjectRepository(database.pool),
      restartedStore,
      () => now,
      () => redundantKey,
    )
    const reused = await deduplicatingService.uploadTemporary(userId, {
      body,
      mediaType: 'application/octet-stream',
      originalFilename: 'duplicate.bin',
    })
    expect(reused.id).toBe(committed.id)
    expect(await restartedStore.stat(redundantKey)).toBeNull()
    restartedStore.close()
  })

  it('never collects an object while either of two authoritative references remains', async () => {
    const oldTime = new Date('2026-09-01T00:00:00.000Z')
    const cleanupTime = new Date('2026-09-02T01:00:00.000Z')
    const store = new S3ContentObjectStore(s3Config)
    const oldService = new ContentObjectService(
      new PostgresContentObjectRepository(database.pool),
      store,
      () => oldTime,
    )
    const body = Buffer.from('shared referenced content')
    const temporary = await oldService.uploadTemporary(userId, {
      body,
      mediaType: 'text/plain',
      originalFilename: 'shared.txt',
    })
    storageKeys.add(temporary.storageKey)
    const committed = await oldService.commitTemporary(
      userId,
      temporary.id,
      createHash('sha256').update(body).digest('hex'),
    )
    const challengeIds = await createTwoContestChallenges(database, userId)
    for (const challengeId of challengeIds) {
      await database.pool.query(`
        INSERT INTO content_references (content_object_id, reference_type, contest_challenge_id)
        VALUES ($1, 'challenge_attachment', $2)`, [committed.id, challengeId])
    }

    const cleanup = new ContentObjectService(
      new PostgresContentObjectRepository(database.pool),
      store,
      () => cleanupTime,
    )
    await expect(cleanup.collectGarbage()).resolves.toEqual({ collected: 0 })
    await database.pool.query('DELETE FROM contest_challenges WHERE id = $1', [challengeIds[0]])
    await expect(cleanup.collectGarbage()).resolves.toEqual({ collected: 0 })
    expect(await store.stat(committed.storageKey)).not.toBeNull()

    await database.pool.query('DELETE FROM contest_challenges WHERE id = $1', [challengeIds[1]])
    await expect(cleanup.collectGarbage()).resolves.toEqual({ collected: 1 })
    expect(await store.stat(committed.storageKey)).toBeNull()
    const state = await database.pool.query<{ status: string }>(
      'SELECT status::text FROM content_objects WHERE id = $1',
      [committed.id],
    )
    expect(state.rows[0]!.status).toBe('deleted')
    store.close()
  })

  it('rejects a stale transaction that references an object after garbage collection claims it', async () => {
    const uploadedAt = new Date('2026-08-31T00:00:00.000Z')
    const cleanupTime = new Date('2026-09-03T00:00:00.000Z')
    const store = new S3ContentObjectStore(s3Config)
    const repository = new PostgresContentObjectRepository(database.pool)
    const service = new ContentObjectService(repository, store, () => uploadedAt)
    const body = Buffer.from('stale reference race')
    const temporary = await service.uploadTemporary(userId, {
      body,
      mediaType: 'text/plain',
      originalFilename: 'stale-reference.txt',
    })
    storageKeys.add(temporary.storageKey)
    const committed = await service.commitTemporary(
      userId,
      temporary.id,
      createHash('sha256').update(body).digest('hex'),
    )
    const [challengeId] = await createTwoContestChallenges(database, userId)
    const stale = await database.pool.connect()
    try {
      await stale.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
      await stale.query('SELECT status FROM content_objects WHERE id = $1', [committed.id])

      const claimed = await repository.claimGarbage(
        new Date(cleanupTime.getTime() - 24 * 60 * 60 * 1000),
        100,
      )
      expect(claimed.map(object => object.id)).toContain(committed.id)
      await expect(stale.query(`
        INSERT INTO content_references (content_object_id, reference_type, contest_challenge_id)
        VALUES ($1, 'challenge_attachment', $2)`, [committed.id, challengeId]))
        .rejects.toMatchObject({ code: '40001' })
    }
    finally {
      await stale.query('ROLLBACK')
      stale.release()
    }

    const cleanup = new ContentObjectService(repository, store, () => cleanupTime)
    await cleanup.collectGarbage()
    expect(await store.stat(committed.storageKey)).toBeNull()
    store.close()
  })
})

async function createTwoContestChallenges(database: DatabaseClient, userId: string): Promise<[string, string]> {
  const suffix = randomUUID()
  const contest = await database.pool.query<{ id: string }>(`
    INSERT INTO contests (title, slug, start_at, end_at, created_by)
    VALUES ('Content references', $1, now() + interval '1 day', now() + interval '2 days', $2)
    RETURNING id`, [`content-refs-${suffix}`, userId])
  const template = await database.pool.query<{ id: string }>(`
    INSERT INTO challenge_templates (name, slug, created_by, latest_version)
    VALUES ('Content reference template', $1, $2, 1)
    RETURNING id`, [`content-ref-template-${suffix}`, userId])
  const version = await database.pool.query<{ id: string }>(`
    INSERT INTO challenge_template_versions (
      template_id, version_number, title, category, description,
      flag_policy, scoring_policy, instance_policy, created_by
    ) VALUES ($1, 1, 'Reference challenge', 'misc', 'Reference body',
      '{"type":"static","digest":"masked"}', '{"type":"fixed-v1","points":100}',
      '{"type":"none"}', $2)
    RETURNING id`, [template.rows[0]!.id, userId])
  const challengeIds: string[] = []
  for (const index of [1, 2]) {
    const challenge = await database.pool.query<{ id: string }>(`
      INSERT INTO contest_challenges (
        contest_id, source_template_id, source_version_id, title, category,
        description, flag_policy, scoring_policy, instance_policy
      ) VALUES ($1, $2, $3, $4, 'misc', 'Reference body',
        '{"type":"static","digest":"masked"}', '{"type":"fixed-v1","points":100}',
        '{"type":"none"}')
      RETURNING id`, [contest.rows[0]!.id, template.rows[0]!.id, version.rows[0]!.id, `Reference ${index}`])
    challengeIds.push(challenge.rows[0]!.id)
  }
  return challengeIds as [string, string]
}
