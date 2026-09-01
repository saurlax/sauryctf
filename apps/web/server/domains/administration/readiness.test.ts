import { describe, expect, it } from 'vitest'
import { apiErrorSchema } from '../../../shared/contracts/http'
import { evaluateControlPlaneReadiness } from './readiness'

const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f2c'

describe('control-plane readiness', () => {
  it('returns a stable 503 error when required secrets are absent', () => {
    const result = evaluateControlPlaneReadiness({}, requestId)
    expect(result.statusCode).toBe(503)
    expect(apiErrorSchema.parse(result.body).error.request_id).toBe(requestId)
  })

  it('returns ready when required deployment references are present', () => {
    const result = evaluateControlPlaneReadiness({
      DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/sauryctf',
      REDIS_URL: 'redis://127.0.0.1:6379/0',
      PUBLIC_ORIGIN: 'https://ctf.example.test',
      NUXT_SESSION_PASSWORD: 'a-secure-session-password-with-32-characters',
      S3_ENDPOINT: 'http://127.0.0.1:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'sauryctf',
      S3_ACCESS_KEY_ID: 'access-key',
      S3_SECRET_ACCESS_KEY: 'secret-key',
      S3_FORCE_PATH_STYLE: 'true',
    }, requestId)

    expect(result).toEqual({
      statusCode: 200,
      body: { status: 'ready', component: 'control-plane' },
    })
  })
})
