import { createHmac, randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  FlagValidatorExecutionError,
  FlagVerificationConfigurationError,
  FlagVerifier,
  staticFlagDigest,
  SynchronousFlagValidatorRegistry,
  VersionedFlagKeyring,
} from './flag-verifier'

const contestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f90'
const challengeId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f91'
const teamId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f92'
const key = randomBytes(32)

function base(submittedFlag: string) {
  return {
    contestId,
    challengeId,
    teamId,
    submittedFlag,
    flagFormat: 'flag{...}',
  }
}

describe('controlled synchronous Flag verification', () => {
  it('verifies a static SHA-256 digest exactly and returns only a redacted verdict', () => {
    const verifier = new FlagVerifier(new VersionedFlagKeyring({}))
    const policy = { type: 'static' as const, digest: staticFlagDigest('flag{correct}') }
    const accepted = verifier.verify({ ...base('flag{correct}'), policy })
    const rejected = verifier.verify({ ...base('flag{wrong}'), policy })
    const wrongFormat = verifier.verify({ ...base('ctf{correct}'), policy })

    expect(accepted).toEqual({ correct: true })
    expect(rejected).toEqual({ correct: false })
    expect(wrongFormat).toEqual({ correct: false })
    expect(Object.keys(accepted)).toEqual(['correct'])
    expect(JSON.stringify(accepted)).not.toMatch(/flag\{correct\}|digest|submitted|expected/u)
  })

  it('derives a stable team-scoped Flag from the configured key version', () => {
    const material = ['sauryctf:team-flag:v1', contestId, challengeId, teamId].join('\0')
    const token = createHmac('sha256', key).update(material, 'utf8').digest('hex')
    const expected = `flag{${token}}`
    const verifier = new FlagVerifier(new VersionedFlagKeyring({ 7: key }))
    const policy = { type: 'team-derived' as const, key_version: 7 }

    expect(verifier.verify({ ...base(expected), policy })).toEqual({ correct: true })
    expect(verifier.verify({
      ...base(expected),
      teamId: '018f47a2-4ef8-7e2c-9c24-6d68b7451f93',
      policy,
    })).toEqual({ correct: false })
  })

  it('rejects missing key versions and invalid derivation configuration without exposing keys', () => {
    const verifier = new FlagVerifier(new VersionedFlagKeyring({ 1: key }))
    expect(() => verifier.verify({
      ...base('flag{unknown-key}'),
      policy: { type: 'team-derived', key_version: 2 },
    })).toThrowError(FlagVerificationConfigurationError)
    expect(() => new VersionedFlagKeyring({ 1: randomBytes(16) })).toThrowError(
      FlagVerificationConfigurationError,
    )
    expect(() => verifier.verify({
      ...base('flag{invalid-format}'),
      flagFormat: 'flag{...}-duplicate-...',
      policy: { type: 'team-derived', key_version: 1 },
    })).toThrowError(FlagVerificationConfigurationError)
  })

  it('runs only explicitly registered in-process validators and redacts their verdict', () => {
    const validator = vi.fn(input => input.submittedFlag === `proof:${input.teamId}`)
    const verifier = new FlagVerifier(
      new VersionedFlagKeyring({}),
      new SynchronousFlagValidatorRegistry({ 'proof-v1': validator }),
    )
    const policy = { type: 'synchronous' as const, validator: 'proof-v1' }
    const result = verifier.verify({
      ...base(`proof:${teamId}`),
      flagFormat: 'proof:...',
      policy,
    })

    expect(result).toEqual({ correct: true })
    expect(validator).toHaveBeenCalledWith(Object.freeze(expect.objectContaining({
      contestId,
      challengeId,
      teamId,
    })))
    expect(result).not.toHaveProperty('validator')
  })

  it('fails closed for unknown, throwing, or invalid synchronous validators', () => {
    const unknown = new FlagVerifier(new VersionedFlagKeyring({}))
    expect(() => unknown.verify({
      ...base('flag{x}'),
      policy: { type: 'synchronous', validator: 'missing-v1' },
    })).toThrowError(FlagVerificationConfigurationError)

    const throwing = new FlagVerifier(
      new VersionedFlagKeyring({}),
      new SynchronousFlagValidatorRegistry({
        'throwing-v1': () => { throw new Error('secret implementation failure') },
        'invalid-v1': (() => 'yes') as never,
      }),
    )
    expect(() => throwing.verify({
      ...base('flag{x}'),
      policy: { type: 'synchronous', validator: 'throwing-v1' },
    })).toThrowError(FlagValidatorExecutionError)
    expect(() => throwing.verify({
      ...base('flag{x}'),
      policy: { type: 'synchronous', validator: 'invalid-v1' },
    })).toThrowError(FlagValidatorExecutionError)
  })
})
