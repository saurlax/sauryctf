import { createHash } from 'node:crypto'
import { strToU8, unzipSync, zipSync } from 'fflate'
import {
  contestPackageFormat,
  contestPackageManifestSchema,
  type ContestPackageManifest,
} from '../../../shared/contracts/contest-packages'
import { assertImplicitJeopardyContestPayload } from '../../domains/contests/admission'
import type { ContentObjectStore } from '../../domains/content/service'
import type { ContestPackageSnapshot } from '../../domains/contest-packages/repository'
import {
  ContestPackageArchiveError,
  type ContestPackageArchive,
  type ParsedContestPackage,
} from '../../domains/contest-packages/archive'

export const maximumContestPackageCompressedBytes = 64 * 1024 * 1024
export const maximumContestPackageUncompressedBytes = 256 * 1024 * 1024
export const maximumContestPackageEntries = 1001
export const maximumContestPackageCompressionRatio = 200
const maximumManifestBytes = 1024 * 1024

type ContentReader = Pick<ContentObjectStore, 'read'>

export class ContestPackageArchiveCodec implements ContestPackageArchive {
  constructor(private readonly content: ContentReader) {}

  async build(snapshot: ContestPackageSnapshot, exportedAt: Date): Promise<{
    body: Uint8Array
    manifest: ContestPackageManifest
  }> {
    const bodies = new Map<string, Uint8Array>()
    const fileMetadata = new Map<string, ContestPackageManifest['files'][number]>()
    const challenges: ContestPackageManifest['contest']['challenges'] = []

    for (const challenge of snapshot.challenges) {
      const assets: ContestPackageManifest['contest']['challenges'][number]['assets'] = []
      for (const asset of challenge.assets) {
        const path = `files/${asset.sha256Hex}`
        const body = await this.content.read(asset.storageKey)
        if (!body
          || body.byteLength !== asset.sizeBytes
          || digest(body) !== asset.sha256Hex) {
          throw new ContestPackageArchiveError(
            'package.digest_mismatch',
            `附件 ${asset.displayName} 与权威摘要不一致`,
          )
        }
        bodies.set(path, body)
        fileMetadata.set(path, {
          path,
          sha256: asset.sha256Hex,
          size_bytes: asset.sizeBytes,
          media_type: asset.mediaType,
          filename: asset.filename,
        })
        assets.push({ path, display_name: asset.displayName, sort_order: asset.sortOrder })
      }
      challenges.push({
        title: challenge.title,
        category: challenge.category,
        description: challenge.description,
        flag_format: challenge.flagFormat,
        flag_policy: challenge.flagPolicy,
        scoring_policy: challenge.scoringPolicy,
        instance_policy: challenge.instancePolicy,
        assets,
        hints: challenge.hints.map(hint => ({
          title: hint.title,
          content: hint.content,
          release_at: hint.releaseAt?.toISOString() ?? null,
          sort_order: hint.sortOrder,
        })),
        enabled: challenge.enabled,
        publish_at: challenge.publishAt?.toISOString() ?? null,
        close_at: challenge.closeAt?.toISOString() ?? null,
        submission_limit: challenge.submissionLimit,
        sort_order: challenge.sortOrder,
      })
    }

    const manifest = contestPackageManifestSchema.parse({
      format: contestPackageFormat,
      compatibility: { minimum: '1.0.0', maximum: '1.x' },
      exported_at: exportedAt.toISOString(),
      contest: {
        title: snapshot.title,
        slug: snapshot.slug,
        description: snapshot.description,
        visibility: snapshot.visibility,
        registration_strategy: snapshot.registrationStrategy,
        invite_required: snapshot.inviteRequired,
        start_at: snapshot.startAt.toISOString(),
        end_at: snapshot.endAt.toISOString(),
        scoreboard_freeze_at: snapshot.scoreboardFreezeAt?.toISOString() ?? null,
        practice_enabled: snapshot.practiceEnabled,
        writeup_required: snapshot.writeupRequired,
        writeup_deadline_at: snapshot.writeupDeadlineAt?.toISOString() ?? null,
        min_team_size: snapshot.minTeamSize,
        max_team_size: snapshot.maxTeamSize,
        registration_constraints: {
          allowed_email_domains: snapshot.registrationConstraints.allowedEmailDomains,
        },
        divisions: snapshot.divisions.map(division => ({
          name: division.name,
          sort_order: division.sortOrder,
        })),
        challenges,
      },
      files: [...fileMetadata.values()].sort((left, right) => left.path.localeCompare(right.path)),
    })

    const entries: Record<string, Uint8Array> = {
      'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    }
    for (const [path, body] of bodies) entries[path] = body
    return { body: zipSync(entries, { level: 9 }), manifest }
  }

  parse(body: Uint8Array): ParsedContestPackage {
    if (body.byteLength === 0 || body.byteLength > maximumContestPackageCompressedBytes) {
      throw new ContestPackageArchiveError('package.size_limit_exceeded', '比赛包压缩文件超过大小限制')
    }
    let entryCount = 0
    let totalUncompressed = 0
    const seen = new Set<string>()
    let archive: Record<string, Uint8Array>
    try {
      archive = unzipSync(body, {
        filter: (entry) => {
          entryCount++
          if (entryCount > maximumContestPackageEntries) {
            throw new ContestPackageArchiveError('package.entry_limit_exceeded', '比赛包条目数超过限制')
          }
          assertSafePath(entry.name)
          if (seen.has(entry.name)) {
            throw new ContestPackageArchiveError('package.path_invalid', '比赛包包含重复路径')
          }
          seen.add(entry.name)
          totalUncompressed += entry.originalSize
          if (totalUncompressed > maximumContestPackageUncompressedBytes) {
            throw new ContestPackageArchiveError('package.size_limit_exceeded', '比赛包解压后超过大小限制')
          }
          if (entry.originalSize > maximumManifestBytes
            && entry.originalSize / Math.max(1, entry.size) > maximumContestPackageCompressionRatio) {
            throw new ContestPackageArchiveError(
              'package.compression_ratio_exceeded',
              '比赛包条目的压缩比超过安全限制',
            )
          }
          if (entry.compression !== 0 && entry.compression !== 8) {
            throw new ContestPackageArchiveError('package.archive_invalid', '比赛包使用了不支持的压缩算法')
          }
          return true
        },
      })
    }
    catch (error) {
      if (error instanceof ContestPackageArchiveError) throw error
      throw new ContestPackageArchiveError('package.archive_invalid', '比赛包不是有效的 ZIP 文件')
    }

    const manifestBytes = archive['manifest.json']
    if (!manifestBytes || manifestBytes.byteLength > maximumManifestBytes) {
      throw new ContestPackageArchiveError('package.manifest_invalid', '比赛包缺少有效清单')
    }
    let rawManifest: unknown
    try {
      rawManifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes))
      assertImplicitJeopardyContestPayload(rawManifest, 'import')
    }
    catch (error) {
      if (error instanceof ContestPackageArchiveError) throw error
      throw new ContestPackageArchiveError('package.manifest_invalid', '比赛包清单不是受支持的 Jeopardy 格式')
    }
    const parsed = contestPackageManifestSchema.safeParse(rawManifest)
    if (!parsed.success) {
      throw new ContestPackageArchiveError('package.manifest_invalid', '比赛包清单字段无效')
    }
    const manifest = parsed.data
    const expectedPaths = new Set(['manifest.json'])
    for (const file of manifest.files) {
      if (file.path !== `files/${file.sha256}`) {
        throw new ContestPackageArchiveError('package.path_invalid', '文件路径必须由内容摘要确定')
      }
      expectedPaths.add(file.path)
      const bytes = archive[file.path]
      if (!bytes || bytes.byteLength !== file.size_bytes) {
        throw new ContestPackageArchiveError('package.file_set_invalid', '比赛包文件与清单不一致')
      }
      if (digest(bytes) !== file.sha256) {
        throw new ContestPackageArchiveError('package.digest_mismatch', '比赛包文件摘要校验失败')
      }
    }
    if (Object.keys(archive).some(path => !expectedPaths.has(path))
      || expectedPaths.size !== Object.keys(archive).length) {
      throw new ContestPackageArchiveError('package.file_set_invalid', '比赛包包含未声明或缺失文件')
    }
    return {
      manifest,
      files: new Map(manifest.files.map(file => [file.path, archive[file.path]!])),
    }
  }
}

function assertSafePath(path: string) {
  if (!path || path.length > 512 || path.includes('\\') || path.includes('\0')
    || path.startsWith('/') || /^[a-z]:/iu.test(path)
    || path.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new ContestPackageArchiveError('package.path_invalid', '比赛包包含越界或非规范路径')
  }
}

function digest(body: Uint8Array) {
  return createHash('sha256').update(body).digest('hex')
}
