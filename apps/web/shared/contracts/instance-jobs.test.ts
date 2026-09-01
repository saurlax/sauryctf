import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  instanceJobOperationSchema,
  instanceJobSchema,
  type InstanceJob,
} from './instance-jobs'

const fixturesRoot = new URL('../../../../contracts/fixtures/instance-jobs/', import.meta.url)
const validFixtures = ['ensure', 'inspect', 'destroy', 'reconcile'] as const

async function fixture(name: string, kind: 'v1' | 'invalid' = 'v1'): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`${kind}/${name}.json`, fixturesRoot), 'utf8')) as unknown
}

describe('versioned instance job contract', () => {
  it('round-trips every v1 operation through the shared JSON fixtures', async () => {
    for (const operation of validFixtures) {
      const source = await fixture(operation)
      const parsed = instanceJobSchema.parse(source)
      const roundTripped = instanceJobSchema.parse(JSON.parse(JSON.stringify(parsed)))

      expect(parsed.operation).toBe(operation)
      expect(roundTripped).toEqual(parsed)
      expect(roundTripped).toEqual(source)
    }
  })

  it('keeps the operation allowlist limited to instance orchestration', () => {
    expect(instanceJobOperationSchema.options).toEqual(['ensure', 'inspect', 'destroy', 'reconcile'])
  })

  it('rejects unknown operations before interpreting their payload', async () => {
    expect(instanceJobSchema.safeParse(await fixture('unknown-operation', 'invalid')).success).toBe(false)
  })

  it('rejects operation and payload shape mismatches', async () => {
    const ensure = await fixture('ensure') as Record<string, unknown>
    const mismatched = { ...ensure, operation: 'inspect' }
    expect(instanceJobSchema.safeParse(mismatched).success).toBe(false)
  })

  it('rejects unknown fields, unknown versions, and invalid reconcile states', async () => {
    const inspect = await fixture('inspect') as InstanceJob
    expect(instanceJobSchema.safeParse({ ...inspect, unexpected: true }).success).toBe(false)
    expect(instanceJobSchema.safeParse({ ...inspect, payload_version: 2 }).success).toBe(false)

    const reconcile = await fixture('reconcile') as InstanceJob
    expect(instanceJobSchema.safeParse({
      ...reconcile,
      payload: { ...reconcile.payload, desired_state: 'running', spec: null },
    }).success).toBe(false)
  })

  it('rejects duplicate ports, reserved environment, and unsafe resource values', async () => {
    const ensure = instanceJobSchema.parse(await fixture('ensure'))
    if (ensure.operation !== 'ensure') throw new Error('ensure fixture has the wrong operation')

    const invalidSpec = {
      ...ensure.payload.spec,
      entrypoints: [
        ...ensure.payload.spec.entrypoints,
        { name: 'duplicate', protocol: 'http', container_port: 8080 },
      ],
      environment: [{ name: 'SAURYCTF_FLAG', value: 'must-not-be-plain-text' }],
      resources: { ...ensure.payload.spec.resources, cpu_millicores: 0 },
    }
    expect(instanceJobSchema.safeParse({
      ...ensure,
      payload: { ...ensure.payload, spec: invalidSpec },
    }).success).toBe(false)
  })
})
