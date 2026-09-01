import { randomBytes, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabaseClient, type DatabaseClient } from '../../infrastructure/db/client'
import { PostgresChallengeTemplateRepository } from '../../infrastructure/db/challenge-template-repository'
import { runMigrations } from '../../infrastructure/db/migrate'
import type { SessionSubject } from '../identity/repository'
import { ChallengeTemplateService } from './service'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName() {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected database name')
  return `"${databaseName}"`
}

describeWithPostgres('challenge template immutable version maintenance', () => {
  let admin: Client
  let database: DatabaseClient
  let templates: ChallengeTemplateService
  let sequence = 0

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 12 })
    await runMigrations(database)
    templates = new ChallengeTemplateService(new PostgresChallengeTemplateRepository(database.pool))
  })

  afterAll(async () => {
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

  async function user(role: SessionSubject['role'] = 'organizer'): Promise<SessionSubject> {
    sequence++
    const username = `ChallengeAuthor${sequence}`
    const email = `challenge-author-${sequence}@example.test`
    const result = await database.pool.query<{ id: string }>(
      `INSERT INTO users
         (username, username_normalized, email, email_normalized, email_verified_at)
       VALUES ($1::varchar(64), lower($1::text)::varchar(64),
               $2::varchar(320), lower($2::text)::varchar(320), CURRENT_TIMESTAMP)
       RETURNING id`,
      [username, email],
    )
    return {
      userId: result.rows[0]!.id,
      username,
      email,
      emailVerified: true,
      status: 'active',
      role,
      sessionVersion: 1,
      mustChangePassword: false,
    }
  }

  async function content(actorId: string, filename: string) {
    const result = await database.pool.query<{ id: string }>(
      `INSERT INTO content_objects
         (storage_key, sha256_digest, size_bytes, media_type, original_filename,
          status, created_by, committed_at)
       VALUES ($1, $2, 128, 'application/octet-stream', $3,
               'committed', $4, CURRENT_TIMESTAMP)
       RETURNING id`,
      [`objects/${randomUUID()}`, randomBytes(32), filename, actorId],
    )
    return result.rows[0]!.id
  }

  async function create(organizer: SessionSubject, assets: Array<{
    contentObjectId: string
    displayName: string
    sortOrder: number
  }> = []) {
    sequence++
    return templates.create(organizer, {
      requestId: randomUUID(),
      name: `Challenge Template ${sequence}`,
      slug: `challenge-template-${sequence}`,
      title: `Challenge Version ${sequence}`,
      category: 'web',
      description: 'Original immutable statement',
      flagFormat: 'flag{...}',
      flagPolicy: { type: 'static', digest: 'a'.repeat(64) },
      scoringPolicy: { type: 'fixed-v1', points: 500 },
      instancePolicy: { type: 'none' },
      assets,
      hints: [{
        title: 'Starter hint',
        content: 'Look at the response headers',
        releaseAfterSeconds: 900,
        sortOrder: 0,
      }],
    })
  }

  it('creates an initial immutable version with committed attachments and audit evidence', async () => {
    const organizer = await user()
    const objectId = await content(organizer.userId, 'starter.zip')
    const created = await create(organizer, [{
      contentObjectId: objectId, displayName: 'starter.zip', sortOrder: 10,
    }])

    expect(created).toMatchObject({
      template: { latestVersion: 1, version: 1 },
      challengeVersion: {
        versionNumber: 1,
        description: 'Original immutable statement',
        assets: [expect.objectContaining({ contentObjectId: objectId, displayName: 'starter.zip' })],
        hints: [expect.objectContaining({ title: 'Starter hint', releaseAfterSeconds: 900 })],
      },
    })
    const audit = await database.pool.query<{ action: string, target_id: string }>(
      `SELECT action, target_id FROM audit_events WHERE target_id = $1`,
      [created.template.id],
    )
    expect(audit.rows).toEqual([{
      action: 'challenge.template.created',
      target_id: created.template.id,
    }])
    const temporary = await database.pool.query<{ id: string }>(
      `INSERT INTO content_objects
         (storage_key, sha256_digest, size_bytes, media_type, original_filename, status, created_by)
       VALUES ($1, $2, 16, 'application/octet-stream', 'temporary.bin', 'temporary', $3)
       RETURNING id`,
      [`temporary/${randomUUID()}`, randomBytes(32), organizer.userId],
    )
    await expect(database.pool.query(
      `INSERT INTO challenge_template_assets
         (template_version_id, content_object_id, display_name)
       VALUES ($1, $2, 'temporary.bin')`,
      [created.challengeVersion.id, temporary.rows[0]!.id],
    )).rejects.toMatchObject({ code: '23514' })
  })

  it('creates a new version for a statement update without overwriting history', async () => {
    const organizer = await user()
    const created = await create(organizer)
    const updated = await templates.createVersion(organizer, {
      requestId: randomUUID(),
      templateId: created.template.id,
      expectedVersion: created.template.version,
      reason: 'Clarify the challenge statement',
      description: 'Clarified immutable statement',
    })

    expect(updated).toMatchObject({
      template: { latestVersion: 2, version: 2 },
      challengeVersion: { versionNumber: 2, description: 'Clarified immutable statement' },
    })
    await expect(templates.read(organizer, created.template.id, 1)).resolves.toMatchObject({
      challengeVersion: { id: created.challengeVersion.id, description: 'Original immutable statement' },
    })
    await expect(database.pool.query(
      `UPDATE challenge_template_versions SET description = 'Overwrite' WHERE id = $1`,
      [created.challengeVersion.id],
    )).rejects.toMatchObject({ code: '55000' })
  })

  it('creates a new version for attachment replacement and preserves the old attachment set', async () => {
    const organizer = await user()
    const oldObjectId = await content(organizer.userId, 'old.zip')
    const newObjectId = await content(organizer.userId, 'new.zip')
    const created = await create(organizer, [{
      contentObjectId: oldObjectId, displayName: 'challenge.zip', sortOrder: 0,
    }])
    const updated = await templates.createVersion(organizer, {
      requestId: randomUUID(),
      templateId: created.template.id,
      expectedVersion: created.template.version,
      reason: 'Replace the downloadable attachment',
      assets: [{ contentObjectId: newObjectId, displayName: 'challenge.zip', sortOrder: 0 }],
    })

    expect(updated.challengeVersion.assets.map(asset => asset.contentObjectId)).toEqual([newObjectId])
    const historical = await templates.read(organizer, created.template.id, 1)
    expect(historical.challengeVersion.assets.map(asset => asset.contentObjectId)).toEqual([oldObjectId])
    await expect(database.pool.query(
      `UPDATE challenge_template_assets SET display_name = 'overwrite.zip' WHERE id = $1`,
      [historical.challengeVersion.assets[0]!.id],
    )).rejects.toMatchObject({ code: '55000' })
    await expect(database.pool.query(
      `UPDATE challenge_template_hints SET content = 'overwrite' WHERE id = $1`,
      [historical.challengeVersion.hints[0]!.id],
    )).rejects.toMatchObject({ code: '55000' })
  })

  it('rejects unavailable attachments atomically with resource-specific fields', async () => {
    const organizer = await user()
    const unavailableId = randomUUID()
    const before = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM challenge_templates',
    )
    await expect(create(organizer, [{
      contentObjectId: unavailableId, displayName: 'missing.zip', sortOrder: 0,
    }])).rejects.toMatchObject({
      code: 'challenge.asset_unavailable',
      fields: { [`assets.${unavailableId}`]: ['内容对象不存在、未提交或已被隔离'] },
    })
    const after = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM challenge_templates',
    )
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count)
  })

  it('serializes concurrent versions and rejects stale template resources', async () => {
    const organizer = await user()
    const created = await create(organizer)
    const results = await Promise.allSettled([
      templates.createVersion(organizer, {
        requestId: randomUUID(), templateId: created.template.id,
        expectedVersion: 1, reason: 'Concurrent update A', description: 'Concurrent statement A',
      }),
      templates.createVersion(organizer, {
        requestId: randomUUID(), templateId: created.template.id,
        expectedVersion: 1, reason: 'Concurrent update B', description: 'Concurrent statement B',
      }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: { code: 'resource.version_conflict' },
    })
    await expect(templates.read(organizer, created.template.id)).resolves.toMatchObject({
      template: { latestVersion: 2, version: 2 },
    })
  })

  it('rejects no-op versions and ordinary-user maintenance', async () => {
    const organizer = await user()
    const ordinary = await user('user')
    const created = await create(organizer)
    await expect(templates.createVersion(organizer, {
      requestId: randomUUID(), templateId: created.template.id,
      expectedVersion: 1, reason: 'No effective change', title: created.challengeVersion.title,
    })).rejects.toMatchObject({ code: 'challenge.version_unchanged' })
    await expect(templates.read(ordinary, created.template.id)).rejects.toMatchObject({
      code: 'identity.capability_forbidden',
    })
  })

  it('rejects invalid orthogonal policies at the domain boundary', async () => {
    const organizer = await user()
    sequence++
    await expect(templates.create(organizer, {
      requestId: randomUUID(),
      name: `Invalid Policy Template ${sequence}`,
      slug: `invalid-policy-template-${sequence}`,
      title: 'Invalid Policy Challenge',
      category: 'web',
      description: 'Invalid policy input must not reach persistence',
      flagFormat: 'flag{...}',
      flagPolicy: { type: 'team-derived', key_version: 0 },
      scoringPolicy: { type: 'fixed-v1', points: 500 },
      instancePolicy: { type: 'none' },
      assets: [],
      hints: [],
    })).rejects.toMatchObject({
      code: 'challenge.policy_invalid',
      fields: { 'flag_policy.key_version': expect.any(Array) },
    })
  })

  it('accepts independent category, Flag, scoring, and instance policy choices', async () => {
    const organizer = await user()
    sequence++
    await expect(templates.create(organizer, {
      requestId: randomUUID(),
      name: `Orthogonal Policy Template ${sequence}`,
      slug: `orthogonal-policy-template-${sequence}`,
      title: 'Orthogonal Policy Challenge',
      category: 'pwn',
      description: 'The strategy axes are independent from the display category',
      flagFormat: 'flag{...}',
      flagPolicy: { type: 'team-derived', key_version: 2 },
      scoringPolicy: {
        type: 'decay-v1',
        initial_points: 500,
        minimum_points: 100,
        decay_solves: 50,
      },
      instancePolicy: { type: 'none' },
      assets: [],
      hints: [],
    })).resolves.toMatchObject({
      challengeVersion: {
        category: 'pwn',
        flagPolicy: { type: 'team-derived', key_version: 2 },
        scoringPolicy: { type: 'decay-v1', minimum_points: 100 },
        instancePolicy: { type: 'none' },
      },
    })
  })
})
