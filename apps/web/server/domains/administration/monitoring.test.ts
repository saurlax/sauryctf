import { describe, expect, it, vi } from 'vitest'
import type { MonitoringRepository } from './monitoring'
import { AdministrationMonitoringService } from './monitoring'
import type { SessionSubject } from '../identity/repository'

const at = new Date('2026-09-02T00:00:00.000Z')
const admin: SessionSubject = {
  userId: '018f47a2-4ef8-7e2c-9c24-000000000401',
  username: 'Operator',
  email: 'operator@example.test',
  emailVerified: true,
  status: 'active',
  role: 'admin',
  sessionVersion: 1,
  mustChangePassword: false,
}

describe('administration monitoring service', () => {
  it('returns an authoritative snapshot with a fixed Worker staleness boundary', async () => {
    const repository: MonitoringRepository = { list: vi.fn(async () => []) }
    const service = new AdministrationMonitoringService(repository, 125_000, () => at)
    const query = { kind: 'instances' as const, limit: 50 }

    await expect(service.list(admin, query)).resolves.toEqual({
      generated_at: at.toISOString(),
      source: 'postgresql',
      cache_observed_at: null,
      worker_stale_after_seconds: 125,
      items: [],
    })
    expect(repository.list).toHaveBeenCalledWith(query, at, 125_000)
  })

  it('rejects organizer access even when the service is called without the HTTP adapter', async () => {
    const repository: MonitoringRepository = { list: vi.fn(async () => []) }
    const service = new AdministrationMonitoringService(repository)

    await expect(service.list({ ...admin, role: 'organizer' }, {
      kind: 'instances',
      limit: 50,
    })).rejects.toMatchObject({ code: 'identity.capability_forbidden' })
    expect(repository.list).not.toHaveBeenCalled()
  })
})
