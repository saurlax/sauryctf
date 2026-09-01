import type { ContestPackageManifest } from '../../../shared/contracts/contest-packages'
import type { ContestPackageSnapshot } from './repository'

export type ContestPackageArchiveErrorCode =
  | 'package.archive_invalid'
  | 'package.compression_ratio_exceeded'
  | 'package.digest_mismatch'
  | 'package.entry_limit_exceeded'
  | 'package.file_set_invalid'
  | 'package.manifest_invalid'
  | 'package.path_invalid'
  | 'package.size_limit_exceeded'

export class ContestPackageArchiveError extends Error {
  constructor(readonly code: ContestPackageArchiveErrorCode, message: string) {
    super(message)
    this.name = 'ContestPackageArchiveError'
  }
}

export interface ParsedContestPackage {
  manifest: ContestPackageManifest
  files: Map<string, Uint8Array>
}

export interface ContestPackageArchive {
  build(snapshot: ContestPackageSnapshot, exportedAt: Date): Promise<{
    body: Uint8Array
    manifest: ContestPackageManifest
  }>
  parse(body: Uint8Array): ParsedContestPackage
}
