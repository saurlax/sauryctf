import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { PostgresTestClient as Client } from '../../test-support/postgres-database'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { identityTokenCodec } from '../../infrastructure/auth/identity-token-codec'
import { AesGcmIdentityMailTokenProtector } from '../../infrastructure/auth/identity-mail-token-protector'
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../../test-support/postgres-database'
import { PostgresIdentityRepository } from '../../infrastructure/db/identity-repository'
import { runPostgresTestMigrations } from '../../test-support/postgres-database'
import { identityCapability, requireIdentityCapability } from './capabilities'
import type { PasswordHasher } from './password'
import { defaultAdministrator, IdentityService } from './service'
import { IdentitySessionService } from './session'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

function quotedDatabaseName(): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected test database name')
  return `"${databaseName}"`
}

class TestScryptHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return `$scrypt$test$${scryptSync(password, 'sauryctf-bootstrap-test', 32).toString('hex')}`
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    const expectedHex = passwordHash.split('$')[3]
    if (!expectedHex) return false
    const expected = Buffer.from(expectedHex, 'hex')
    const actual = scryptSync(password, 'sauryctf-bootstrap-test', expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }

  needsRehash(): boolean { return false }
}

describeWithPostgres('default administrator bootstrap', () => {
  let admin: Client
  let database: PostgresTestDatabase
  let service: IdentityService
  let repository: PostgresIdentityRepository

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quotedDatabaseName()}`)
    const url = new URL(adminConnectionString!)
    url.pathname = `/${databaseName}`
    database = createPostgresTestDatabase({ connectionString: url.toString(), maxConnections: 4 })
    await runPostgresTestMigrations(database)
    repository = new PostgresIdentityRepository(database.executor)
    service = new IdentityService(
      repository,
      new TestScryptHasher(),
      identityTokenCodec,
      undefined,
      new AesGcmIdentityMailTokenProtector('bootstrap-test-secret-that-is-at-least-32-characters'),
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

  it('creates once only on an empty user table and requires password plus verified email setup', async () => {
    await service.register({
      username: 'ExistingUser',
      email: 'existing@example.test',
      password: 'existing password',
    })
    await expect(service.bootstrapDefaultAdministrator()).resolves.toEqual({ created: false, identity: null })
    await expect(database.executor.query('SELECT count(*)::int AS count FROM users'))
      .resolves.toMatchObject({ rows: [{ count: 1 }] })

    await database.executor.query('TRUNCATE TABLE users CASCADE')
    const concurrent = await Promise.all([
      service.bootstrapDefaultAdministrator(),
      service.bootstrapDefaultAdministrator(),
    ])
    expect(concurrent.filter(result => result.created)).toHaveLength(1)
    expect(concurrent.filter(result => !result.created)).toHaveLength(1)

    const login = await service.login({
      identifier: defaultAdministrator.username,
      password: defaultAdministrator.password,
    })
    const initialSubject = await repository.findSessionSubject(login.userId)
    expect(initialSubject).toMatchObject({
      username: 'admin',
      email: defaultAdministrator.placeholderEmail,
      emailVerified: false,
      role: 'admin',
      mustChangePassword: true,
      sessionVersion: 1,
    })
    expect(() => requireIdentityCapability(initialSubject!, identityCapability.contestManage))
      .toThrowError(expect.objectContaining({ code: 'identity.account_setup_required' }))

    const password = await service.changePassword(
      login.userId,
      defaultAdministrator.password,
      'replacement administrator password',
    )
    const passwordChangedSubject = await repository.findSessionSubject(login.userId)
    expect(password.sessionVersion).toBe(2)
    expect(() => requireIdentityCapability(passwordChangedSubject!, identityCapability.contestManage))
      .toThrowError(expect.objectContaining({ code: 'identity.email_verification_required' }))

    const email = await service.changeEmail(login.userId, 'operator@example.test')
    const verification = await service.requestEmailVerification(login.userId)
    await service.verifyEmail(verification.token)
    const readySubject = await repository.findSessionSubject(login.userId)
    expect(email.sessionVersion).toBe(3)
    expect(readySubject).toMatchObject({
      email: 'operator@example.test',
      emailVerified: true,
      role: 'admin',
      mustChangePassword: false,
      sessionVersion: 3,
    })
    expect(() => requireIdentityCapability(readySubject!, identityCapability.contestManage)).not.toThrow()

    const sessions = new IdentitySessionService(repository)
    await expect(sessions.validate({
      user_id: login.userId,
      session_version: login.sessionVersion,
      logged_in_at: '2026-09-01T07:08:09.123Z',
    })).rejects.toMatchObject({ name: 'InvalidIdentitySessionError' })
    await expect(service.login({
      identifier: defaultAdministrator.username,
      password: defaultAdministrator.password,
    })).rejects.toMatchObject({ code: 'identity.invalid_credentials' })
    await expect(service.login({
      identifier: defaultAdministrator.username,
      password: 'replacement administrator password',
    })).resolves.toMatchObject({ sessionVersion: 3 })
  })
})
