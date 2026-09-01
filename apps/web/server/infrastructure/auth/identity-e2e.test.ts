import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import {
  createApp,
  eventHandler,
  setResponseStatus,
  toWebHandler,
  type H3Event,
} from 'h3'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import { DisabledHumanVerificationProvider } from '../../domains/identity/human-verification'
import { IdentityService } from '../../domains/identity/service'
import { IdentitySessionService } from '../../domains/identity/session'
import type { PasswordHasher } from '../../domains/identity/password'
import { createDatabaseClient, type DatabaseClient } from '../db/client'
import { PostgresIdentityRepository } from '../db/identity-repository'
import { runMigrations } from '../db/migrate'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from '../security/rate-limit'
import {
  handleChangeGlobalRole,
  handleChangePassword,
  handleChangeUserStatus,
  handleCurrentIdentity,
  handleListManagedIdentities,
  handleLogin,
  handleLogout,
  handleRegister,
  type BrowserSessionAdapter,
  type IdentityHttpDependencies,
} from './identity-http'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`

const testPasswordHasher: PasswordHasher = {
  async hash(password) {
    return `$scrypt$e2e$${scryptSync(password, 'sauryctf-identity-e2e', 32).toString('hex')}`
  },
  async verify(passwordHash, password) {
    const expectedHex = passwordHash.split('$').at(-1)
    if (!expectedHex) return false
    const expected = Buffer.from(expectedHex, 'hex')
    const actual = scryptSync(password, 'sauryctf-identity-e2e', expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  },
  needsRehash: passwordHash => !passwordHash.startsWith('$scrypt$e2e$'),
}

function quoteIdentifier(identifier: string): string {
  if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(identifier)) throw new Error('Unexpected test database name')
  return `"${identifier}"`
}

function databaseUrl(adminUrl: string, name: string): string {
  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  return url.toString()
}

function sessionJar(initial: unknown = null) {
  let value = initial
  const adapter: BrowserSessionAdapter = {
    read: async () => value,
    replace: async (_event, session) => { value = structuredClone(session) },
    clear: async () => { value = null },
  }
  return {
    adapter,
    get: () => structuredClone(value) as AuthSessionData | null,
    set: (session: unknown) => { value = structuredClone(session) },
  }
}

type HttpHandler = (event: H3Event, dependencies: IdentityHttpDependencies) => Promise<unknown>

async function request(
  handler: HttpHandler,
  dependencies: IdentityHttpDependencies,
  options: { method?: string, body?: unknown, path?: string } = {},
): Promise<Response> {
  const app = createApp()
  app.use(eventHandler(async (event) => {
    try {
      return await handler(event, dependencies)
    }
    catch (error) {
      const normalized = normalizeApiError(error, '018f47a2-4ef8-7e2c-9c24-6d68b7451e2e')
      setResponseStatus(event, normalized.statusCode)
      return normalized.body
    }
  }))
  const method = options.method ?? 'POST'
  return toWebHandler(app)(new Request(`https://ctf.example.test${options.path ?? '/api/auth/test'}`, {
    method,
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }))
}

describeWithPostgres('identity HTTP to PostgreSQL flow', () => {
  let admin: Client
  let database: DatabaseClient
  let identity: IdentityService
  let sessions: IdentitySessionService

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
    database = createDatabaseClient({
      connectionString: databaseUrl(adminConnectionString!, databaseName),
      applicationName: 'sauryctf-identity-e2e',
      maxConnections: 4,
    })
    await runMigrations(database)
    const repository = new PostgresIdentityRepository(database.pool)
    identity = new IdentityService(repository, testPasswordHasher)
    sessions = new IdentitySessionService(repository)
  }, 30_000)

  afterAll(async () => {
    if (database) await database.pool.end()
    if (admin) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [databaseName],
      )
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`)
      await admin.end()
    }
  })

  function dependencies(browserSession: BrowserSessionAdapter): IdentityHttpDependencies {
    return {
      identity,
      sessions,
      browserSession,
      humanVerification: new DisabledHumanVerificationProvider(),
      rateLimits: new MemoryRateLimitStore(),
    }
  }

  it('covers registration, current user, password rotation, logout, login and admin revocation', async () => {
    const playerJar = sessionJar()
    const player = dependencies(playerJar.adapter)
    const registered = await request(handleRegister, player, {
      body: {
        username: 'IdentityPlayer',
        email: 'identity-player@example.test',
        password: 'initial password value',
      },
    })
    expect(registered.status, await registered.clone().text()).toBe(201)
    const registeredBody = await registered.json() as { user: { id: string, email_verified: boolean } }
    expect(registeredBody.user.email_verified).toBe(false)
    const playerId = registeredBody.user.id
    const originalSession = playerJar.get()

    const current = await request(handleCurrentIdentity, player, { method: 'GET' })
    expect(current.status).toBe(200)
    await expect(current.json()).resolves.toMatchObject({ user: { id: playerId, role: 'user' } })

    const changed = await request(handleChangePassword, player, {
      body: { current_password: 'initial password value', new_password: 'replacement password value' },
    })
    expect(changed.status).toBe(200)
    expect(playerJar.get()?.session_version).toBe((originalSession?.session_version ?? 0) + 1)

    const staleJar = sessionJar(originalSession)
    const stale = await request(handleCurrentIdentity, dependencies(staleJar.adapter), { method: 'GET' })
    expect(stale.status).toBe(401)
    expect(staleJar.get()).toBeNull()

    const loggedOut = await request(handleLogout, player)
    expect(loggedOut.status).toBe(200)
    expect(playerJar.get()).toBeNull()

    const oldLogin = await request(handleLogin, player, {
      body: { identifier: 'IdentityPlayer', password: 'initial password value' },
    })
    expect(oldLogin.status).toBe(401)
    const newLogin = await request(handleLogin, player, {
      body: { identifier: 'identity-player@example.test', password: 'replacement password value' },
    })
    expect(newLogin.status).toBe(200)
    const activePlayerSession = playerJar.get()

    const adminIdentity = await identity.register({
      username: 'IdentityAdmin',
      email: 'identity-admin@example.test',
      password: 'administrator password value',
    })
    await database.pool.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [adminIdentity.userId])
    await database.pool.query("UPDATE user_roles SET role = 'admin' WHERE user_id = $1", [adminIdentity.userId])
    const adminJar = sessionJar()
    const adminDependencies = dependencies(adminJar.adapter)
    const adminLogin = await request(handleLogin, adminDependencies, {
      body: { identifier: 'IdentityAdmin', password: 'administrator password value' },
    })
    expect(adminLogin.status).toBe(200)

    const list = await request(handleListManagedIdentities, adminDependencies, {
      method: 'GET',
      path: '/api/admin/users?limit=100',
    })
    expect(list.status).toBe(200)
    await expect(list.json()).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: playerId, role: 'user' })]),
      page: { has_more: false, next_cursor: null },
    })

    const role = await request(
      (event, deps) => handleChangeGlobalRole(event, deps, playerId),
      adminDependencies,
      { body: { role: 'organizer' } },
    )
    expect(role.status).toBe(200)
    const banned = await request(
      (event, deps) => handleChangeUserStatus(event, deps, playerId),
      adminDependencies,
      { body: { status: 'banned' } },
    )
    expect(banned.status).toBe(200)

    playerJar.set(activePlayerSession)
    const revoked = await request(handleCurrentIdentity, player, { method: 'GET' })
    expect(revoked.status).toBe(401)
    const bannedLogin = await request(handleLogin, player, {
      body: { identifier: 'IdentityPlayer', password: 'replacement password value' },
    })
    expect(bannedLogin.status).toBe(401)
  }, 30_000)
})
