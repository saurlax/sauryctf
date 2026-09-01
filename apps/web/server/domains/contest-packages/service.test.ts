import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { contestPackageFormat, contestPackageManifestSchema } from '../../../shared/contracts/contest-packages'
import type { ContentObject } from '../content/service'
import type { ContestPackageArchive } from './archive'
import type { ContestPackageRepository } from './repository'
import { ContestPackageService } from './service'

const actorId = '00000000-0000-4000-8000-000000000001'
const packageObjectId = '00000000-0000-4000-8000-000000000002'
const contestId = '00000000-0000-4000-8000-000000000003'

describe('ContestPackageService', () => {
  it('requires a newly supplied invite secret instead of exporting or inventing one', async () => {
    const fixture = serviceFixture(true)
    await expect(fixture.service.importContest(actorId, {
      requestId: '00000000-0000-4000-8000-000000000004',
      idempotencyKey: 'contest-package-import-1',
      packageObjectId,
      reason: 'import private event content',
    })).rejects.toMatchObject({ code: 'package.invite_code_required' })
    expect(fixture.repository.importDraft).not.toHaveBeenCalled()
  })

  it('hashes the replacement invite and passes only validated files to the atomic repository', async () => {
    const fixture = serviceFixture(true)
    const inviteCode = 'new-import-invite-code-0000000001'
    const result = await fixture.service.importContest(actorId, {
      requestId: '00000000-0000-4000-8000-000000000005',
      idempotencyKey: 'contest-package-import-2',
      packageObjectId,
      inviteCode,
      reason: 'import private event content',
    })

    expect(result.contest_id).toBe(contestId)
    expect(fixture.repository.importDraft).toHaveBeenCalledWith(expect.objectContaining({
      inviteDigest: createHash('sha256').update(inviteCode).digest(),
      files: [],
    }))
  })
})

function serviceFixture(inviteRequired: boolean) {
  const manifest = contestPackageManifestSchema.parse({
    format: contestPackageFormat,
    compatibility: { minimum: '1.0.0', maximum: '1.x' },
    exported_at: '2026-09-02T00:00:00.000Z',
    contest: {
      title: 'Private CTF',
      slug: 'private-ctf',
      description: '',
      visibility: 'private',
      registration_strategy: 'review',
      invite_required: inviteRequired,
      start_at: '2026-10-01T00:00:00.000Z',
      end_at: '2026-10-02T00:00:00.000Z',
      scoreboard_freeze_at: null,
      practice_enabled: false,
      writeup_required: false,
      writeup_deadline_at: null,
      min_team_size: 1,
      max_team_size: 5,
      registration_constraints: { allowed_email_domains: [] },
      divisions: [],
      challenges: [],
    },
    files: [],
  })
  const repository = {
    readSnapshot: vi.fn<ContestPackageRepository['readSnapshot']>(),
    recordExport: vi.fn<ContestPackageRepository['recordExport']>(),
    readExport: vi.fn<ContestPackageRepository['readExport']>(),
    importDraft: vi.fn<ContestPackageRepository['importDraft']>().mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000006',
      packageObjectId,
      packageVersion: contestPackageFormat,
      contestId,
      createdAt: new Date('2026-09-02T00:00:00.000Z'),
    }),
  }
  const packageObject: ContentObject = {
    id: packageObjectId,
    storageKey: 'packages/import.zip',
    sha256Hex: 'a'.repeat(64),
    sizeBytes: 3,
    mediaType: 'application/zip',
    originalFilename: 'import.zip',
    status: 'committed',
    createdBy: actorId,
    committedAt: new Date('2026-09-02T00:00:00.000Z'),
    createdAt: new Date('2026-09-02T00:00:00.000Z'),
  }
  const content = {
    createCommitted: vi.fn().mockResolvedValue(packageObject),
    readCommitted: vi.fn().mockResolvedValue({ object: packageObject, body: new Uint8Array([1, 2, 3]) }),
    readOwnedCommitted: vi.fn().mockResolvedValue({ object: packageObject, body: new Uint8Array([1, 2, 3]) }),
  }
  const archive: ContestPackageArchive = {
    build: vi.fn(),
    parse: vi.fn().mockReturnValue({ manifest, files: new Map() }),
  }
  return {
    repository,
    service: new ContestPackageService(repository, content, archive),
  }
}
