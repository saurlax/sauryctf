import { describe, expect, it, vi } from 'vitest'
import { apiErrorSchema } from '../../../shared/contracts/http'
import { evaluateControlPlaneReadiness } from './readiness'

const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c'

describe('control-plane readiness', () => {
  it('returns a stable 503 error when required secrets are absent', async () => {
    const dependencies = { ready: vi.fn(async () => undefined) }
    const result = await evaluateControlPlaneReadiness({}, dependencies, requestId)
    expect(result.statusCode).toBe(503)
    expect(apiErrorSchema.parse(result.body).error.request_id).toBe(requestId)
    expect(dependencies.ready).not.toHaveBeenCalled()
  })

  it('returns ready when required deployment references and dependencies are ready', async () => {
    const result = await evaluateControlPlaneReadiness({
      DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/sauryctf',
      PUBLIC_ORIGIN: 'https://ctf.example.test',
      NUXT_SESSION_PASSWORD: 'a-secure-session-password-with-32-characters',
      SUBMISSION_ANSWER_KEY: 'c2F1cnljdGYtZGV2LXN1Ym1pc3Npb24ta2V5LTAwMDE',
      INSTANCE_SECRET_ACTIVE_KEY_ID: 'worker-key-v1',
      INSTANCE_SECRET_KEYS: '{"worker-key-v1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"}',
    }, { ready: async () => undefined }, requestId)

    expect(result).toEqual({
      statusCode: 200,
      body: { status: 'ready', component: 'control-plane' },
    })
  })

  it('returns a sanitized 503 when PostgreSQL or migrations are unavailable', async () => {
    const result = await evaluateControlPlaneReadiness(readyEnvironment(), {
      ready: async () => { throw new Error('postgresql://user:secret@database') },
    }, requestId)

    expect(result.statusCode).toBe(503)
    expect(JSON.stringify(result.body)).not.toContain('secret@database')
    expect(apiErrorSchema.parse(result.body).error.fields).toEqual({
      dependencies: ['PostgreSQL 不可用或数据库迁移版本与当前发布不一致'],
    })
  })
})

function readyEnvironment() {
  return {
    DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/sauryctf',
    PUBLIC_ORIGIN: 'https://ctf.example.test',
    NUXT_SESSION_PASSWORD: 'a-secure-session-password-with-32-characters',
    SUBMISSION_ANSWER_KEY: 'c2F1cnljdGYtZGV2LXN1Ym1pc3Npb24ta2V5LTAwMDE',
    INSTANCE_SECRET_ACTIVE_KEY_ID: 'worker-key-v1',
    INSTANCE_SECRET_KEYS: '{"worker-key-v1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"}',
  }
}
