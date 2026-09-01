import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { contestPackageFormat } from '../../../shared/contracts/contest-packages'
import { ContestPackageArchiveError } from '../../domains/contest-packages/archive'
import type { ContestPackageSnapshot } from '../../domains/contest-packages/repository'
import { ContestPackageArchiveCodec } from './contest-package-archive'

const emptyReader = { read: async () => null }

describe('ContestPackageArchiveCodec', () => {
  it('round-trips a versioned Jeopardy manifest', async () => {
    const codec = new ContestPackageArchiveCodec(emptyReader)
    const built = await codec.build(snapshot(), new Date('2026-09-02T00:00:00.000Z'))
    const parsed = codec.parse(built.body)

    expect(parsed.manifest.format).toBe(contestPackageFormat)
    expect(parsed.manifest.compatibility).toEqual({ minimum: '1.0.0', maximum: '1.x' })
    expect(parsed.manifest.contest.title).toBe('Autumn CTF')
  })

  it('rejects AWD and mixed-mode manifest configuration', () => {
    const manifest = validManifest() as Record<string, unknown>
    manifest.mode = 'awd'
    expectCode(() => codec().parse(packageWith(manifest)), 'package.manifest_invalid')

    const nested = validManifest() as { contest: Record<string, unknown> }
    nested.contest.services = [{ name: 'pwn' }]
    expectCode(() => codec().parse(packageWith(nested)), 'package.manifest_invalid')
  })

  it('rejects path traversal before extracting entries', () => {
    const archive = zipSync({
      'manifest.json': json(validManifest()),
      '../outside.txt': strToU8('no'),
    })
    expectCode(() => codec().parse(archive), 'package.path_invalid')
  })

  it('rejects a compressed bomb by declared expansion ratio', () => {
    const bomb = new Uint8Array(2 * 1024 * 1024)
    const sha256 = digest(bomb)
    const manifest = validManifest({
      files: [{
        path: `files/${sha256}`,
        sha256,
        size_bytes: bomb.byteLength,
        media_type: 'application/octet-stream',
        filename: 'bomb.bin',
      }],
    })
    const archive = zipSync({
      'manifest.json': json(manifest),
      [`files/${sha256}`]: bomb,
    }, { level: 9 })
    expectCode(() => codec().parse(archive), 'package.compression_ratio_exceeded')
  })

  it('rejects file digest mismatches', () => {
    const body = strToU8('tampered')
    const declared = 'a'.repeat(64)
    const manifest = validManifest({
      files: [{
        path: `files/${declared}`,
        sha256: declared,
        size_bytes: body.byteLength,
        media_type: 'text/plain',
        filename: 'readme.txt',
      }],
    })
    const archive = zipSync({
      'manifest.json': json(manifest),
      [`files/${declared}`]: body,
    })
    expectCode(() => codec().parse(archive), 'package.digest_mismatch')
  })

  it('rejects undeclared archive entries', () => {
    const archive = zipSync({
      'manifest.json': json(validManifest()),
      'files/extra': strToU8('extra'),
    })
    expectCode(() => codec().parse(archive), 'package.file_set_invalid')
  })
})

function codec() {
  return new ContestPackageArchiveCodec(emptyReader)
}

function snapshot(): ContestPackageSnapshot {
  return {
    contestId: '00000000-0000-4000-8000-000000000001',
    title: 'Autumn CTF',
    slug: 'autumn-ctf',
    description: 'Jeopardy contest',
    visibility: 'public',
    registrationStrategy: 'review',
    inviteRequired: false,
    startAt: new Date('2026-10-01T00:00:00.000Z'),
    endAt: new Date('2026-10-02T00:00:00.000Z'),
    scoreboardFreezeAt: null,
    practiceEnabled: true,
    writeupRequired: false,
    writeupDeadlineAt: null,
    minTeamSize: 1,
    maxTeamSize: 5,
    registrationConstraints: { allowedEmailDomains: [] },
    divisions: [],
    challenges: [],
  }
}

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    format: contestPackageFormat,
    compatibility: { minimum: '1.0.0', maximum: '1.x' },
    exported_at: '2026-09-02T00:00:00.000Z',
    contest: {
      title: 'Autumn CTF',
      slug: 'autumn-ctf',
      description: 'Jeopardy contest',
      visibility: 'public',
      registration_strategy: 'review',
      invite_required: false,
      start_at: '2026-10-01T00:00:00.000Z',
      end_at: '2026-10-02T00:00:00.000Z',
      scoreboard_freeze_at: null,
      practice_enabled: true,
      writeup_required: false,
      writeup_deadline_at: null,
      min_team_size: 1,
      max_team_size: 5,
      registration_constraints: { allowed_email_domains: [] },
      divisions: [],
      challenges: [],
    },
    files: [],
    ...overrides,
  }
}

function packageWith(manifest: unknown) {
  return zipSync({ 'manifest.json': json(manifest) })
}

function json(value: unknown) {
  return strToU8(`${JSON.stringify(value)}\n`)
}

function digest(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

function expectCode(operation: () => unknown, code: string) {
  try {
    operation()
    throw new Error('Expected archive operation to fail')
  }
  catch (error) {
    expect(error).toBeInstanceOf(ContestPackageArchiveError)
    expect((error as ContestPackageArchiveError).code).toBe(code)
  }
}
