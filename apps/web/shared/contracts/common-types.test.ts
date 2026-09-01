import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  commonTypesFixtureSchema,
  maxSafeContractInteger,
  resourceVersionSchema,
  scoreSchema,
  toUtcTimestamp,
  utcTimestampSchema,
  uuidSchema,
} from './common-types'

const fixtureUrl = new URL('../../../../contracts/fixtures/common-types.json', import.meta.url)

describe('cross-language common types', () => {
  it('round-trips the shared JSON fixture without loss', async () => {
    const source = JSON.parse(await readFile(fixtureUrl, 'utf8')) as unknown
    const parsed = commonTypesFixtureSchema.parse(source)
    const roundTripped = commonTypesFixtureSchema.parse(JSON.parse(JSON.stringify(parsed)))

    expect(roundTripped).toEqual(parsed)
    expect(roundTripped.score).toBe(-maxSafeContractInteger)
    expect(roundTripped.version).toBe(maxSafeContractInteger)
  })

  it('accepts only canonical lower-case RFC UUIDs', () => {
    expect(uuidSchema.parse('018f47a2-4ef8-7e2c-9c24-6d68b7451f2c'))
      .toBe('018f47a2-4ef8-7e2c-9c24-6d68b7451f2c')
    expect(() => uuidSchema.parse('018F47A2-4EF8-7E2C-9C24-6D68B7451F2C')).toThrow()
    expect(() => uuidSchema.parse('00000000-0000-0000-0000-000000000000')).toThrow()
  })

  it('requires canonical UTC milliseconds and formats Date values consistently', () => {
    expect(toUtcTimestamp(new Date('2026-09-01T15:08:09.123+08:00')))
      .toBe('2026-09-01T07:08:09.123Z')
    expect(() => utcTimestampSchema.parse('2026-09-01T15:08:09.123+08:00')).toThrow()
    expect(() => utcTimestampSchema.parse('2026-09-01T07:08:09Z')).toThrow()
  })

  it('rejects fractional, unsafe, and invalid version integers', () => {
    expect(scoreSchema.parse(-maxSafeContractInteger)).toBe(-maxSafeContractInteger)
    expect(() => scoreSchema.parse(1.5)).toThrow()
    expect(() => scoreSchema.parse(maxSafeContractInteger + 1)).toThrow()
    expect(() => resourceVersionSchema.parse(0)).toThrow()
    expect(() => resourceVersionSchema.parse(maxSafeContractInteger + 1)).toThrow()
  })
})
