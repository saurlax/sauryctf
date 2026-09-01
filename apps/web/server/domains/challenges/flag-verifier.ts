import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { ChallengeFlagPolicy } from '../../../shared/contracts/challenges'

const maximumFlagBytes = 1024
const teamFlagDomain = 'sauryctf:team-flag:v1'

export interface FlagVerificationContext {
  contestId: string
  challengeId: string
  teamId: string
  submittedFlag: string
  flagFormat: string | null
  policy: ChallengeFlagPolicy
}

export interface FlagVerificationResult {
  correct: boolean
}

export interface SynchronousFlagValidatorInput {
  contestId: string
  challengeId: string
  teamId: string
  submittedFlag: string
  flagFormat: string | null
}

export type SynchronousFlagValidator = (input: Readonly<SynchronousFlagValidatorInput>) => boolean

export interface FlagDerivationKeyring {
  key(version: number): Uint8Array | null
}

export class FlagVerificationConfigurationError extends Error {
  readonly code = 'challenge.flag_configuration_invalid'

  constructor() {
    super('题目 Flag 校验配置不可用')
    this.name = 'FlagVerificationConfigurationError'
  }
}

export class FlagValidatorExecutionError extends Error {
  readonly code = 'challenge.flag_validator_failed'

  constructor() {
    super('题目 Flag 校验器暂时不可用')
    this.name = 'FlagValidatorExecutionError'
  }
}

export class VersionedFlagKeyring implements FlagDerivationKeyring {
  private readonly keys = new Map<number, Buffer>()

  constructor(entries: Readonly<Record<number, Uint8Array>>) {
    for (const [rawVersion, rawKey] of Object.entries(entries)) {
      const version = Number(rawVersion)
      const key = Buffer.from(rawKey)
      if (!Number.isSafeInteger(version) || version < 1 || key.byteLength < 32) {
        throw new FlagVerificationConfigurationError()
      }
      this.keys.set(version, key)
    }
  }

  key(version: number): Uint8Array | null {
    const key = this.keys.get(version)
    return key ? Buffer.from(key) : null
  }
}

export class SynchronousFlagValidatorRegistry {
  private readonly validators = new Map<string, SynchronousFlagValidator>()

  constructor(entries: Readonly<Record<string, SynchronousFlagValidator>> = {}) {
    for (const [name, validator] of Object.entries(entries)) this.validators.set(name, validator)
  }

  resolve(name: string): SynchronousFlagValidator | null {
    return this.validators.get(name) ?? null
  }
}

export function staticFlagDigest(flag: string): string {
  return createHash('sha256').update(flag, 'utf8').digest('hex')
}

export class FlagVerifier {
  constructor(
    private readonly keyring: FlagDerivationKeyring,
    private readonly validators = new SynchronousFlagValidatorRegistry(),
  ) {}

  verify(input: Readonly<FlagVerificationContext>): FlagVerificationResult {
    const submittedBytes = Buffer.from(input.submittedFlag, 'utf8')
    const withinInputLimit = submittedBytes.byteLength > 0 && submittedBytes.byteLength <= maximumFlagBytes
    const candidate = withinInputLimit ? input.submittedFlag : ''
    const matchesFormat = withinInputLimit && flagMatchesFormat(candidate, input.flagFormat)

    if (input.policy.type === 'static') {
      const expected = Buffer.from(input.policy.digest, 'hex')
      const actual = Buffer.from(staticFlagDigest(candidate), 'hex')
      const answerMatches = constantTimeEqual(actual, expected)
      return redactedResult(matchesFormat && answerMatches)
    }

    if (input.policy.type === 'team-derived') {
      const key = this.keyring.key(input.policy.key_version)
      if (!key || key.byteLength < 32) throw new FlagVerificationConfigurationError()
      const expected = deriveTeamFlag(input, key)
      const answerMatches = constantTimeTextEqual(candidate, expected)
      return redactedResult(matchesFormat && answerMatches)
    }

    const validator = this.validators.resolve(input.policy.validator)
    if (!validator) throw new FlagVerificationConfigurationError()
    if (!withinInputLimit) return redactedResult(false)
    try {
      const correct = validator(Object.freeze({
        contestId: input.contestId,
        challengeId: input.challengeId,
        teamId: input.teamId,
        submittedFlag: input.submittedFlag,
        flagFormat: input.flagFormat,
      }))
      if (typeof correct !== 'boolean') throw new TypeError('Synchronous validator returned a non-boolean value')
      return redactedResult(matchesFormat && correct)
    }
    catch {
      throw new FlagValidatorExecutionError()
    }
  }
}

function redactedResult(correct: boolean): FlagVerificationResult {
  return Object.freeze({ correct })
}

function constantTimeEqual(actual: Uint8Array, expected: Uint8Array) {
  if (actual.byteLength !== expected.byteLength) {
    const padded = createHash('sha256').update(expected).digest()
    timingSafeEqual(createHash('sha256').update(actual).digest(), padded)
    return false
  }
  return timingSafeEqual(actual, expected)
}

function constantTimeTextEqual(actual: string, expected: string) {
  const actualDigest = createHash('sha256').update(actual, 'utf8').digest()
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(actualDigest, expectedDigest)
}

function flagMatchesFormat(flag: string, format: string | null) {
  if (!format) return true
  const marker = '...'
  const firstMarker = format.indexOf(marker)
  if (firstMarker < 0) return constantTimeTextEqual(flag, format)
  if (format.indexOf(marker, firstMarker + marker.length) >= 0) {
    throw new FlagVerificationConfigurationError()
  }
  const prefix = format.slice(0, firstMarker)
  const suffix = format.slice(firstMarker + marker.length)
  return flag.length > prefix.length + suffix.length
    && flag.startsWith(prefix)
    && flag.endsWith(suffix)
}

function deriveTeamFlag(
  input: Pick<FlagVerificationContext, 'challengeId' | 'contestId' | 'flagFormat' | 'teamId'>,
  key: Uint8Array,
) {
  const format = input.flagFormat
  if (!format) throw new FlagVerificationConfigurationError()
  const marker = '...'
  const firstMarker = format.indexOf(marker)
  if (firstMarker < 0 || format.indexOf(marker, firstMarker + marker.length) >= 0) {
    throw new FlagVerificationConfigurationError()
  }
  const material = [teamFlagDomain, input.contestId, input.challengeId, input.teamId].join('\0')
  const token = createHmac('sha256', key).update(material, 'utf8').digest('hex')
  return `${format.slice(0, firstMarker)}${token}${format.slice(firstMarker + marker.length)}`
}
