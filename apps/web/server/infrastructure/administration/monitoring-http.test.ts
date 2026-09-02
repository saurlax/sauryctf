import { createApp, eventHandler, setResponseStatus, toWebHandler, type H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import type { SessionSubject } from '../../domains/identity/repository'
import { DisabledHumanVerificationProvider } from '../../domains/identity/human-verification'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from '../security/rate-limit'
import { handleListMonitoring, type MonitoringHttpDependencies } from './monitoring-http'

const userId = '018f47a2-4ef8-7e2c-9c24-000000000201'
const contestId = '018f47a2-4ef8-7e2c-9c24-000000000202'
const session: AuthSessionData = { user_id: userId, session_version: 1, logged_in_at: '2026-09-02T00:00:00.000Z' }

function dependencies(role: SessionSubject['role'] = 'admin'): MonitoringHttpDependencies {
  const subject: SessionSubject = {
    userId, username: 'Operator', email: 'operator@example.test', emailVerified: true,
    status: 'active', role, sessionVersion: 1, mustChangePassword: false,
  }
  return {
    identity: {
      identity: {} as MonitoringHttpDependencies['identity']['identity'],
      sessions: { validate: vi.fn(async () => subject) },
      humanVerification: new DisabledHumanVerificationProvider(),
      rateLimits: new MemoryRateLimitStore(),
      browserSession: { read: vi.fn(async () => session), replace: vi.fn(), clear: vi.fn() },
    },
    monitoring: {
      list: vi.fn(async () => ({
        generated_at: '2026-09-02T00:00:00.000Z', source: 'postgresql' as const,
        data_services: {
          postgresql: { status: 'ready' as const, migrations: 'current' as const },
          blob: { driver: 'fs' as const, status: 'ready' as const },
        },
        worker_stale_after_seconds: 90, items: [],
      })),
    },
  }
}

async function invoke(request: Request, injected: MonitoringHttpDependencies) {
  const app = createApp()
  app.use(eventHandler(async (event: H3Event) => {
    event.context.requestId = '018f47a2-4ef8-7e2c-9c24-000000000203'
    try { return await handleListMonitoring(event, injected) }
    catch (error) {
      const response = normalizeApiError(error, event.context.requestId)
      setResponseStatus(event, response.statusCode)
      return response.body
    }
  }))
  return toWebHandler(app)(request)
}

describe('administration monitoring HTTP adapter', () => {
  it('passes contest, kind and status filters to the authoritative service', async () => {
    const injected = dependencies()
    const response = await invoke(new Request(`https://ctf.example.test/api/admin/monitoring?kind=instance_jobs&contest_id=${contestId}&status=dead&limit=25`), injected)
    expect(response.status).toBe(200)
    expect(injected.monitoring.list).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }), {
      kind: 'instance_jobs', contest_id: contestId, status: 'dead', limit: 25,
    })
    await expect(response.json()).resolves.toMatchObject({
      source: 'postgresql',
      data_services: {
        postgresql: { status: 'ready', migrations: 'current' },
        blob: { driver: 'fs', status: 'ready' },
      },
    })
  })

  it('rejects organizer access to global operational facts', async () => {
    const response = await invoke(new Request('https://ctf.example.test/api/admin/monitoring'), dependencies('organizer'))
    expect(response.status).toBe(403)
  })
})
