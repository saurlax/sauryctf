import { describe, expect, it } from 'vitest'
import {
  deploymentConfigFieldErrors,
  inspectDeploymentConfig,
  parseDeploymentConfig,
  type DeploymentEnvironment,
} from './deployment-config'

const validEnvironment: DeploymentEnvironment = {
  DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/sauryctf',
  NUXT_PUBLIC_SITE_URL: 'https://ctf.example.test',
  NUXT_SESSION_PASSWORD: 'a-secure-session-password-with-32-characters',
  SUBMISSION_ANSWER_KEY: 'c2F1cnljdGYtZGV2LXN1Ym1pc3Npb24ta2V5LTAwMDE',
  INSTANCE_SECRET_ACTIVE_KEY_ID: 'worker-key-v1',
  INSTANCE_SECRET_KEYS: '{"worker-key-v1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"}',
}

describe('production deployment config', () => {
  it('parses environment-only deployment secrets', () => {
    const config = parseDeploymentConfig(validEnvironment)
    expect(config.databaseUrl).toContain('postgresql://')
    expect(config.siteUrl).toBe('https://ctf.example.test')
  })

  it('defaults the public site URL to local Nuxt development', () => {
    const config = parseDeploymentConfig({ ...validEnvironment, NUXT_PUBLIC_SITE_URL: undefined })
    expect(config.siteUrl).toBe('http://localhost:3000')
  })

  it.each([
    ['NUXT_SESSION_PASSWORD'],
    ['SUBMISSION_ANSWER_KEY'],
    ['INSTANCE_SECRET_ACTIVE_KEY_ID'],
    ['INSTANCE_SECRET_KEYS'],
    ['DATABASE_URL'],
  ])('does not become ready without %s', (key) => {
    const environment = { ...validEnvironment, [key]: undefined }
    expect(inspectDeploymentConfig(environment).success).toBe(false)
  })

  it('reports field names without exposing secret values', () => {
    const secret = 'do-not-leak-this-secret'
    const result = inspectDeploymentConfig({
      ...validEnvironment,
      NUXT_SESSION_PASSWORD: secret,
    })
    expect(result.success).toBe(false)
    if (result.success) return

    const fields = deploymentConfigFieldErrors(result.error)
    expect(fields).toHaveProperty('sessionPassword')
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

  it('requires the active instance envelope key to exist in the deployment keyring', () => {
    expect(inspectDeploymentConfig({
      ...validEnvironment,
      INSTANCE_SECRET_ACTIVE_KEY_ID: 'missing-key',
    }).success).toBe(false)
  })
})
