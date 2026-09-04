import { randomBytes, randomUUID } from 'node:crypto'
import { PostgresTestClient as Client } from '../../test-support/postgres-database'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SessionSubject } from '../identity/repository'
import { PublicRegistrationDisabledError } from '../identity/repository'
import { PostgresIdentityRepository } from '../../infrastructure/db/identity-repository'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { runPostgresTestMigrations } from '../../test-support/postgres-database'
import { PostgresContentObjectRepository } from '../../infrastructure/db/content-object-repository'
import { ContentObjectService, type ContentObjectStore, type StoredContentObject } from '../content/service'
import { PostgresPlatformSettingsRepository } from '../../infrastructure/db/platform-settings-repository'
import { PlatformSettingsService } from './service'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName() {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected database name')
  return `"${databaseName}"`
}

describeWithPostgres('typed platform settings', () => {
  let admin: Client
  let database: PostgresTestDatabase
  let service: PlatformSettingsService
  let administrator: SessionSubject
  const store = new MemoryStore()

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createPostgresTestDatabase({ connectionString: url.toString(), maxConnections: 6 })
    await runPostgresTestMigrations(database)
    const user = await database.executor.query<{ id: string }>(`
      INSERT INTO users
        (username, username_normalized, email, email_normalized, email_verified_at)
      VALUES ('SettingsAdmin', 'settingsadmin',
              'settings@example.test', 'settings@example.test', now())
      RETURNING id`)
    await database.executor.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`,
      [user.rows[0]!.id],
    )
    administrator = {
      userId: user.rows[0]!.id,
      username: 'SettingsAdmin',
      email: 'settings@example.test',
      emailVerified: true,
      status: 'active',
      role: 'admin',
      sessionVersion: 1,
      mustChangePassword: false,
    }
    const content = new ContentObjectService(
      new PostgresContentObjectRepository(database.executor),
      store,
    )
    service = new PlatformSettingsService(
      new PostgresPlatformSettingsRepository(database.executor),
      content,
    )
  })

  afterAll(async () => {
    if (database) await database.close()
    if (admin) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [databaseName],
      )
      await admin.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName()}`)
      await admin.end()
    }
  })

  it('seeds public defaults and updates brand, logo, theme, locale, registration and auth atomically', async () => {
    const defaults = await service.readPublic()
    expect(defaults).toMatchObject({
      brandName: 'SauryCTF',
      logoObjectId: null,
      theme: 'dark',
      defaultLocale: 'zh-CN',
      publicRegistrationEnabled: true,
      authenticationMode: 'password_only',
      version: 1,
    })
    const logoBody = Buffer.from('not-decoded-by-control-plane')
    const content = new ContentObjectService(
      new PostgresContentObjectRepository(database.executor),
      store,
      () => new Date('2026-09-02T00:00:00.000Z'),
      () => `temporary/${randomUUID()}`,
    )
    const logo = await content.createCommitted(administrator.userId, {
      body: logoBody,
      mediaType: 'image/png',
      originalFilename: 'logo.png',
    })
    const requestId = randomUUID()
    const updated = await service.update(administrator, {
      requestId,
      expectedVersion: defaults.version,
      reason: 'apply public platform identity',
      brandName: 'SauryCTF Arena',
      logoObjectId: logo.id,
      theme: 'dark',
      defaultLocale: 'en',
      publicRegistrationEnabled: false,
      authenticationMode: 'password_only',
    })
    expect(updated).toMatchObject({
      brandName: 'SauryCTF Arena',
      logoObjectId: logo.id,
      theme: 'dark',
      defaultLocale: 'en',
      publicRegistrationEnabled: false,
      authenticationMode: 'password_only',
      version: 2,
      updatedBy: administrator.userId,
    })
    await expect(service.readLogo()).resolves.toMatchObject({
      mediaType: 'image/png',
      filename: 'logo.png',
      body: expect.any(Uint8Array),
    })
    const evidence = await database.executor.query<{ references: string, audits: string }>(`
      SELECT
        (SELECT count(*)::text FROM content_references
          WHERE reference_type = 'platform_logo' AND platform_setting_id = true) AS references,
        (SELECT count(*)::text FROM audit_events
          WHERE request_id = $1 AND action = 'platform.settings.updated') AS audits`, [requestId])
    expect(evidence.rows[0]).toEqual({ references: '1', audits: '1' })
  })

  it('rejects stale versions and unavailable logo types without partial changes', async () => {
    const before = await service.readPublic()
    await expect(service.update(administrator, {
      requestId: randomUUID(),
      expectedVersion: before.version - 1,
      reason: 'stale administrative request',
      theme: 'light',
    })).rejects.toMatchObject({ code: 'resource.version_conflict' })

    const object = await database.executor.query<{ id: string }>(`
      INSERT INTO content_objects
        (storage_key, sha256_digest, size_bytes, media_type, original_filename,
         status, created_by, committed_at)
      VALUES ($1, $2, 10, 'text/html', 'unsafe.html', 'committed', $3, now())
      RETURNING id`, [`objects/${randomUUID()}`, randomBytes(32), administrator.userId])
    await expect(service.update(administrator, {
      requestId: randomUUID(),
      expectedVersion: before.version,
      reason: 'reject active content logo',
      logoObjectId: object.rows[0]!.id,
    })).rejects.toMatchObject({ code: 'platform.logo_unavailable' })
    expect(await service.readPublic()).toEqual(before)
  })

  it('makes the public registration switch authoritative in the identity transaction', async () => {
    const repository = new PostgresIdentityRepository(database.executor)
    await expect(repository.createIdentity({
      username: 'ClosedRegistration',
      usernameNormalized: 'closedregistration',
      email: 'closed@example.test',
      emailNormalized: 'closed@example.test',
      passwordHash: 'scrypt-test-hash',
    })).rejects.toBeInstanceOf(PublicRegistrationDisabledError)
    const result = await database.executor.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM users WHERE username_normalized = 'closedregistration'`)
    expect(result.rows[0]!.count).toBe('0')
  })
})

class MemoryStore implements ContentObjectStore {
  readonly values = new Map<string, { body: Uint8Array, metadata: StoredContentObject }>()

  async put(input: { storageKey: string, body: Uint8Array, sizeBytes: number, sha256Hex: string, mediaType: string }) {
    this.values.set(input.storageKey, {
      body: Uint8Array.from(input.body),
      metadata: {
        sizeBytes: input.sizeBytes,
        sha256Hex: input.sha256Hex,
        mediaType: input.mediaType,
      },
    })
  }

  async stat(storageKey: string) {
    return this.values.get(storageKey)?.metadata ?? null
  }

  async read(storageKey: string) {
    const body = this.values.get(storageKey)?.body
    return body ? Uint8Array.from(body) : null
  }

  async delete(storageKey: string) {
    this.values.delete(storageKey)
  }

  close() {}
}
