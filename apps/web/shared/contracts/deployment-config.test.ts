import { describe, expect, it } from 'vitest'
import {
  deploymentConfigFieldErrors,
  inspectDeploymentConfig,
  parseDeploymentConfig,
  type DeploymentEnvironment,
} from './deployment-config'

const validEnvironment: DeploymentEnvironment = {
  DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/sauryctf',
  REDIS_URL: 'redis://127.0.0.1:6379/0',
  PUBLIC_ORIGIN: 'https://ctf.example.test',
  NUXT_SESSION_PASSWORD: 'a-secure-session-password-with-32-characters',
  SUBMISSION_ANSWER_KEY: 'c2F1cnljdGYtZGV2LXN1Ym1pc3Npb24ta2V5LTAwMDE',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'sauryctf',
  S3_ACCESS_KEY_ID: 'access-key',
  S3_SECRET_ACCESS_KEY: 'secret-key',
  S3_FORCE_PATH_STYLE: 'true',
}

describe('production deployment config', () => {
  it('parses environment-only deployment secrets', () => {
    const config = parseDeploymentConfig(validEnvironment)
    expect(config.objectStorage.forcePathStyle).toBe(true)
    expect(config.databaseUrl).toContain('postgresql://')
  })

  it.each([
    ['NUXT_SESSION_PASSWORD'],
    ['SUBMISSION_ANSWER_KEY'],
    ['DATABASE_URL'],
    ['REDIS_URL'],
    ['PUBLIC_ORIGIN'],
    ['S3_ENDPOINT'],
    ['S3_BUCKET'],
    ['S3_ACCESS_KEY_ID'],
    ['S3_SECRET_ACCESS_KEY'],
  ])('does not become ready without %s', (key) => {
    const environment = { ...validEnvironment, [key]: undefined }
    expect(inspectDeploymentConfig(environment).success).toBe(false)
  })

  it('reports field names without exposing secret values', () => {
    const secret = 'do-not-leak-this-secret'
    const result = inspectDeploymentConfig({
      ...validEnvironment,
      S3_SECRET_ACCESS_KEY: '',
      NUXT_SESSION_PASSWORD: secret,
    })
    expect(result.success).toBe(false)
    if (result.success) return

    const fields = deploymentConfigFieldErrors(result.error)
    expect(fields).toHaveProperty('objectStorage.secretAccessKey')
    expect(JSON.stringify(fields)).not.toContain(secret)
  })

  it('requires both Turnstile keys when human verification is enabled', () => {
    expect(inspectDeploymentConfig({ ...validEnvironment, TURNSTILE_SECRET_KEY: 'secret' }).success).toBe(false)
    expect(inspectDeploymentConfig({
      ...validEnvironment,
      TURNSTILE_SECRET_KEY: 'secret',
      TURNSTILE_SITE_KEY: 'site',
    }).success).toBe(true)
  })
})
