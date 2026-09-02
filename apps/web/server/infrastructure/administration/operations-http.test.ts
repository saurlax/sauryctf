import { createApp, eventHandler, setResponseStatus, toWebHandler, type H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import type { AuthSessionData } from '../../../shared/contracts/auth-session'
import type { SessionSubject } from '../../domains/identity/repository'
import { DisabledHumanVerificationProvider } from '../../domains/identity/human-verification'
import { normalizeApiError } from '../http/errors'
import { MemoryRateLimitStore } from '../security/rate-limit'
import {
  handleExecuteOperationalCommand,
  type OperationsHttpDependencies,
} from './operations-http'

const requestId = '018f47a2-4ef8-7e2c-9c24-000000000701'
const userId = '018f47a2-4ef8-7e2c-9c24-000000000702'
const targetId = '018f47a2-4ef8-7e2c-9c24-000000000703'
const session: AuthSessionData = {
  user_id: userId,
  session_version: 1,
  logged_in_at: '2026-09-02T00:00:00.000Z',
}

function dependencies(role: SessionSubject['role'] = 'admin'): OperationsHttpDependencies {
  const subject: SessionSubject = {
    userId,
    username: 'Operator',
    email: 'operator@example.test',
    emailVerified: true,
    status: 'active',
    role,
    sessionVersion: 1,
    mustChangePassword: false,
  }
  return {
    identity: {
      identity: {} as OperationsHttpDependencies['identity']['identity'],
      sessions: { validate: vi.fn(async () => subject) },
      humanVerification: new DisabledHumanVerificationProvider(),
      rateLimits: new MemoryRateLimitStore(),
      browserSession: { read: vi.fn(async () => session), replace: vi.fn(), clear: vi.fn() },
    },
    operations: {
      execute: vi.fn(async (_subject, input) => ({
        id: '018f47a2-4ef8-7e2c-9c24-000000000704',
        kind: input.kind,
        target_id: input.targetId,
        status: 'succeeded' as const,
        replayed: false,
        completed_at: '2026-09-02T00:00:00.000Z',
        result: { target_id: input.targetId },
      })),
    },
  }
}

function request(body: Record<string, unknown>, idempotencyKey?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  return new Request('https://ctf.example.test/api/admin/operations', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

async function invoke(input: Request, injected: OperationsHttpDependencies) {
  const app = createApp()
  app.use(eventHandler(async (event: H3Event) => {
    event.context.requestId = requestId
    try { return await handleExecuteOperationalCommand(event, injected) }
    catch (error) {
      const response = normalizeApiError(error, requestId)
      setResponseStatus(event, response.statusCode)
      return response.body
    }
  }))
  return toWebHandler(app)(input)
}

const validBody = {
  kind: 'instance_reconcile',
  target_id: targetId,
  reason: 'Worker 观察状态已经超过阈值，需要执行对账',
  confirmed: true,
}

describe('administration operations HTTP adapter', () => {
  it('executes a confirmed admin command with its caller idempotency key', async () => {
    const deps = dependencies()
    const response = await invoke(request(validBody, 'operation-reconcile-0001'), deps)

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(deps.operations.execute).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }), {
      requestId,
      idempotencyKey: 'operation-reconcile-0001',
      kind: 'instance_reconcile',
      targetId,
      reason: validBody.reason,
    })
  })

  it('rejects organizer access before executing a global repair command', async () => {
    const deps = dependencies('organizer')
    const response = await invoke(request(validBody, 'operation-reconcile-0002'), deps)

    expect(response.status).toBe(403)
    expect(deps.operations.execute).not.toHaveBeenCalled()
  })

  it('requires a valid Idempotency-Key for every command', async () => {
    const deps = dependencies()
    const response = await invoke(request(validBody), deps)

    expect(response.status).toBe(428)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'request.idempotency_key_required' },
    })
    expect(deps.operations.execute).not.toHaveBeenCalled()
  })

  it('rejects missing confirmation and a short reason before the domain service', async () => {
    for (const body of [
      { ...validBody, confirmed: false },
      { ...validBody, reason: 'retry' },
    ]) {
      const deps = dependencies()
      const response = await invoke(request(body, 'operation-validation-0001'), deps)
      expect(response.status).toBe(400)
      expect(deps.operations.execute).not.toHaveBeenCalled()
    }
  })
})
