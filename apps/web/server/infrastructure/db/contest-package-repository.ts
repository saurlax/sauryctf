import { randomUUID } from 'node:crypto'
import type {
  ChallengeCategory,
  ChallengeFlagPolicy,
  ChallengeInstancePolicy,
  ChallengeScoringPolicy,
} from '../../../shared/contracts/challenges'
import { contestPackageFormat } from '../../../shared/contracts/contest-packages'
import {
  ContestPackageContestNotFoundError,
  ContestPackageExportNotFoundError,
  ContestPackageIdempotencyConflictError,
  type ContestPackageChallengeSnapshot,
  type ContestPackageExportRecord,
  type ContestPackageImportRecord,
  type ContestPackageRepository,
  type ContestPackageSnapshot,
} from '../../domains/contest-packages/repository'
import type { DatabaseExecutor } from './executor'

interface ContestRow {
  id: string
  title: string
  slug: string
  description: string
  visibility: 'public' | 'private'
  registration_strategy: 'review' | 'auto_accept'
  invite_required: boolean
  start_at: Date
  end_at: Date
  scoreboard_freeze_at: Date | null
  practice_enabled: boolean
  writeup_required: boolean
  writeup_deadline_at: Date | null
  min_team_size: number
  max_team_size: number
  registration_constraints: unknown
}

interface ChallengeRow {
  id: string
  title: string
  category: ChallengeCategory
  description: string
  flag_format: string | null
  flag_policy: ChallengeFlagPolicy
  scoring_policy: ChallengeScoringPolicy
  instance_policy: ChallengeInstancePolicy
  enabled: boolean
  publish_at: Date | null
  close_at: Date | null
  submission_limit: number | null
  sort_order: number
}

interface ExportRow {
  id: string
  contest_id: string
  package_object_id: string
  package_version: typeof contestPackageFormat
  requested_by: string
  created_at: Date
}

interface ImportRow {
  id: string
  package_object_id: string
  package_version: typeof contestPackageFormat
  requested_by: string
  result_contest_id: string
  created_at: Date
}

export class PostgresContestPackageRepository implements ContestPackageRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async readSnapshot(contestId: string): Promise<ContestPackageSnapshot> {
    const contestResult = await this.database.query<ContestRow>(`
      SELECT id::text, title, slug, description, visibility::text,
             registration_strategy::text, invite_required, start_at, end_at,
             scoreboard_freeze_at, practice_enabled, writeup_required,
             writeup_deadline_at, min_team_size, max_team_size,
             registration_constraints
      FROM contests WHERE id = $1`, [contestId])
    const contest = contestResult.rows[0]
    if (!contest) throw new ContestPackageContestNotFoundError()
    const [divisionResult, challengeResult] = await Promise.all([
      this.database.query<{ name: string, sort_order: number }>(`
        SELECT name, sort_order FROM divisions
        WHERE contest_id = $1 ORDER BY sort_order, id`, [contestId]),
      this.database.query<ChallengeRow>(`
        SELECT id::text, title, category::text, description, flag_format,
               flag_policy, scoring_policy, instance_policy, enabled,
               publish_at, close_at, submission_limit, sort_order
        FROM contest_challenges
        WHERE contest_id = $1 ORDER BY sort_order, id`, [contestId]),
    ])
    const challengeIds = challengeResult.rows.map(row => row.id)
    const [assetResult, hintResult] = challengeIds.length === 0
      ? [{ rows: [] }, { rows: [] }]
      : await Promise.all([
          this.database.query<{
            contest_challenge_id: string
            content_object_id: string
            storage_key: string
            sha256_digest: Buffer
            size_bytes: string | number
            media_type: string
            original_filename: string
            display_name: string
            sort_order: number
          }>(`
            SELECT asset.contest_challenge_id::text, object.id::text AS content_object_id,
                   object.storage_key, object.sha256_digest, object.size_bytes,
                   object.media_type, object.original_filename,
                   asset.display_name, asset.sort_order
            FROM challenge_assets asset
            JOIN content_objects object ON object.id = asset.content_object_id
            WHERE asset.contest_challenge_id = ANY($1::uuid[])
              AND object.status = 'committed'
            ORDER BY asset.sort_order, asset.id`, [challengeIds]),
          this.database.query<{
            contest_challenge_id: string
            title: string
            content: string
            release_at: Date | null
            sort_order: number
          }>(`
            SELECT contest_challenge_id::text, title, content, release_at, sort_order
            FROM challenge_hints
            WHERE contest_challenge_id = ANY($1::uuid[])
            ORDER BY sort_order, id`, [challengeIds]),
        ])
    const challenges: ContestPackageChallengeSnapshot[] = challengeResult.rows.map(challenge => ({
      title: challenge.title,
      category: challenge.category,
      description: challenge.description,
      flagFormat: challenge.flag_format,
      flagPolicy: challenge.flag_policy,
      scoringPolicy: challenge.scoring_policy,
      instancePolicy: challenge.instance_policy,
      enabled: challenge.enabled,
      publishAt: challenge.publish_at,
      closeAt: challenge.close_at,
      submissionLimit: challenge.submission_limit,
      sortOrder: challenge.sort_order,
      assets: assetResult.rows
        .filter(asset => asset.contest_challenge_id === challenge.id)
        .map(asset => ({
          contentObjectId: asset.content_object_id,
          storageKey: asset.storage_key,
          sha256Hex: asset.sha256_digest.toString('hex'),
          sizeBytes: Number(asset.size_bytes),
          mediaType: asset.media_type,
          filename: asset.original_filename,
          displayName: asset.display_name,
          sortOrder: asset.sort_order,
        })),
      hints: hintResult.rows
        .filter(hint => hint.contest_challenge_id === challenge.id)
        .map(hint => ({
          title: hint.title,
          content: hint.content,
          releaseAt: hint.release_at,
          sortOrder: hint.sort_order,
        })),
    }))
    return {
      contestId: contest.id,
      title: contest.title,
      slug: contest.slug,
      description: contest.description,
      visibility: contest.visibility,
      registrationStrategy: contest.registration_strategy,
      inviteRequired: contest.invite_required,
      startAt: contest.start_at,
      endAt: contest.end_at,
      scoreboardFreezeAt: contest.scoreboard_freeze_at,
      practiceEnabled: contest.practice_enabled,
      writeupRequired: contest.writeup_required,
      writeupDeadlineAt: contest.writeup_deadline_at,
      minTeamSize: contest.min_team_size,
      maxTeamSize: contest.max_team_size,
      registrationConstraints: parseRegistrationConstraints(contest.registration_constraints),
      divisions: divisionResult.rows.map(row => ({ name: row.name, sortOrder: row.sort_order })),
      challenges,
    }
  }

  async recordExport(input: {
    actorId: string
    requestId: string
    reason: string
    idempotencyKey: string
    contestId: string
    packageObjectId: string
  }): Promise<ContestPackageExportRecord> {
    return this.database.transaction(async (connection) => {
      const contest = await connection.query('SELECT id FROM contests WHERE id = $1 FOR KEY SHARE', [input.contestId])
      if (!contest.rows[0]) throw new ContestPackageContestNotFoundError()
      const inserted = await connection.query<ExportRow>(`
        INSERT INTO exports
          (contest_id, package_object_id, package_version, status,
           idempotency_key, requested_by, finished_at)
        VALUES ($1, $2, $3, 'succeeded', $4, $5, clock_timestamp())
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id::text, contest_id::text, package_object_id::text,
                  package_version, requested_by::text, created_at`, [
        input.contestId,
        input.packageObjectId,
        contestPackageFormat,
        input.idempotencyKey,
        input.actorId,
      ])
      let row = inserted.rows[0]
      if (!row) {
        const existing = await connection.query<ExportRow>(`
          SELECT id::text, contest_id::text, package_object_id::text,
                 package_version, requested_by::text, created_at
          FROM exports WHERE idempotency_key = $1 AND status = 'succeeded'
          FOR UPDATE`, [input.idempotencyKey])
        row = existing.rows[0]
        if (!row || row.contest_id !== input.contestId || row.requested_by !== input.actorId
          || row.package_object_id !== input.packageObjectId) {
          throw new ContestPackageIdempotencyConflictError()
        }
      }
      if (inserted.rows[0]) {
        await connection.query(`
          INSERT INTO content_references
            (content_object_id, reference_type, export_id)
          VALUES ($1, 'export_package', $2)`, [input.packageObjectId, row.id])
        await writeAudit(connection, {
          actorId: input.actorId,
          requestId: input.requestId,
          action: 'contest.package.exported',
          targetType: 'contest',
          targetId: input.contestId,
          reason: input.reason,
          changes: { export_id: row.id, package_version: contestPackageFormat },
        })
      }
      return exportRecord(row)
    })
  }

  async readExport(exportId: string): Promise<ContestPackageExportRecord> {
    const result = await this.database.query<ExportRow>(`
      SELECT id::text, contest_id::text, package_object_id::text,
             package_version, requested_by::text, created_at
      FROM exports WHERE id = $1 AND status = 'succeeded'`, [exportId])
    if (!result.rows[0]) throw new ContestPackageExportNotFoundError()
    return exportRecord(result.rows[0])
  }

  async importDraft(input: Parameters<ContestPackageRepository['importDraft']>[0]): Promise<ContestPackageImportRecord> {
    try {
      return await this.database.transaction(async (connection) => {
        const existing = await connection.query<ImportRow>(`
          SELECT id::text, package_object_id::text, package_version,
                 requested_by::text, result_contest_id::text, created_at
          FROM imports WHERE idempotency_key = $1 FOR UPDATE`, [input.idempotencyKey])
        if (existing.rows[0]) {
          const row = existing.rows[0]
          if (row.package_object_id !== input.packageObjectId
            || row.requested_by !== input.actorId
            || !row.result_contest_id) {
            throw new ContestPackageIdempotencyConflictError()
          }
          return importRecord(row)
        }
      const fileObjects = new Map(input.files.map(file => [file.path, file.contentObjectId]))
      if (fileObjects.size !== input.manifest.files.length) {
        throw new Error('Validated package files are incomplete')
      }
      const contestId = randomUUID()
      const contestSlug = importedSlug(input.manifest.contest.slug, contestId)
      const transfer = await connection.query<{ id: string, created_at: Date }>(`
        INSERT INTO imports
          (package_object_id, package_version, status, idempotency_key, requested_by)
        VALUES ($1, $2, 'processing', $3, $4)
        RETURNING id::text, created_at`, [
        input.packageObjectId,
        contestPackageFormat,
        input.idempotencyKey,
        input.actorId,
      ])
      await connection.query(`
        INSERT INTO contests
          (id, title, slug, description, publication_status, visibility,
           registration_strategy, invite_required, invite_digest,
           start_at, end_at, scoreboard_freeze_at, practice_enabled,
           writeup_required, writeup_deadline_at, min_team_size, max_team_size,
           registration_constraints, created_by)
        VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`, [
        contestId,
        input.manifest.contest.title,
        contestSlug,
        input.manifest.contest.description,
        input.manifest.contest.visibility,
        input.manifest.contest.registration_strategy,
        input.manifest.contest.invite_required,
        input.inviteDigest,
        input.manifest.contest.start_at,
        input.manifest.contest.end_at,
        input.manifest.contest.scoreboard_freeze_at,
        input.manifest.contest.practice_enabled,
        input.manifest.contest.writeup_required,
        input.manifest.contest.writeup_deadline_at,
        input.manifest.contest.min_team_size,
        input.manifest.contest.max_team_size,
        input.manifest.contest.registration_constraints,
        input.actorId,
      ])
      for (const division of input.manifest.contest.divisions) {
        await connection.query(`
          INSERT INTO divisions (contest_id, name, name_normalized, sort_order)
          VALUES ($1, $2::varchar(80), lower($2::text)::varchar(80), $3)`, [
          contestId,
          division.name,
          division.sort_order,
        ])
      }
      for (const [index, challenge] of input.manifest.contest.challenges.entries()) {
        await insertChallenge(connection, {
          actorId: input.actorId,
          contestId,
          contestStartAt: new Date(input.manifest.contest.start_at),
          challenge,
          index,
          fileObjects,
        })
      }
      const completed = await connection.query<ImportRow>(`
        UPDATE imports
        SET status = 'succeeded', result_contest_id = $2, finished_at = clock_timestamp()
        WHERE id = $1
        RETURNING id::text, package_object_id::text, package_version,
                  requested_by::text, result_contest_id::text, created_at`, [
        transfer.rows[0]!.id,
        contestId,
      ])
      await writeAudit(connection, {
        actorId: input.actorId,
        requestId: input.requestId,
        action: 'contest.package.imported',
        targetType: 'contest',
        targetId: contestId,
        reason: input.reason,
        changes: {
          import_id: transfer.rows[0]!.id,
          package_version: contestPackageFormat,
          source_slug: input.manifest.contest.slug,
          invite_required: input.manifest.contest.invite_required,
        },
      })
        return importRecord(completed.rows[0]!)
      })
    }
    catch (error) {
      if (isUniqueConflict(error)) throw new ContestPackageIdempotencyConflictError()
      throw error
    }
  }
}

async function insertChallenge(
  connection: DatabaseExecutor,
  input: {
    actorId: string
    contestId: string
    contestStartAt: Date
    challenge: Parameters<ContestPackageRepository['importDraft']>[0]['manifest']['contest']['challenges'][number]
    index: number
    fileObjects: Map<string, string>
  },
) {
  const templateId = randomUUID()
  const versionId = randomUUID()
  const challengeId = randomUUID()
  const templateSlug = `imported-${input.contestId.slice(0, 8)}-${input.index + 1}`
  await connection.query(`
    INSERT INTO challenge_templates
      (id, name, slug, created_by, latest_version)
    VALUES ($1, $2, $3, $4, 1)`, [templateId, input.challenge.title, templateSlug, input.actorId])
  await connection.query(`
    INSERT INTO challenge_template_versions
      (id, template_id, version_number, title, category, description,
       flag_format, flag_policy, scoring_policy, instance_policy, created_by)
    VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10)`, [
    versionId,
    templateId,
    input.challenge.title,
    input.challenge.category,
    input.challenge.description,
    input.challenge.flag_format,
    input.challenge.flag_policy,
    input.challenge.scoring_policy,
    input.challenge.instance_policy,
    input.actorId,
  ])
  await connection.query(`
    INSERT INTO contest_challenges
      (id, contest_id, source_template_id, source_version_id, snapshot_revision,
       title, category, description, flag_format, flag_policy, scoring_policy,
       instance_policy, enabled, publish_at, close_at, submission_limit, sort_order)
    VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11,
            $12, $13, $14, $15, $16)`, [
    challengeId,
    input.contestId,
    templateId,
    versionId,
    input.challenge.title,
    input.challenge.category,
    input.challenge.description,
    input.challenge.flag_format,
    input.challenge.flag_policy,
    input.challenge.scoring_policy,
    input.challenge.instance_policy,
    input.challenge.enabled,
    input.challenge.publish_at,
    input.challenge.close_at,
    input.challenge.submission_limit,
    input.challenge.sort_order,
  ])
  for (const asset of input.challenge.assets) {
    const contentObjectId = input.fileObjects.get(asset.path)
    if (!contentObjectId) throw new Error(`Missing imported object for ${asset.path}`)
    await connection.query(`
      INSERT INTO challenge_template_assets
        (template_version_id, content_object_id, display_name, sort_order)
      VALUES ($1, $2, $3, $4)`, [versionId, contentObjectId, asset.display_name, asset.sort_order])
    await connection.query(`
      INSERT INTO challenge_assets
        (contest_challenge_id, content_object_id, display_name, sort_order)
      VALUES ($1, $2, $3, $4)`, [challengeId, contentObjectId, asset.display_name, asset.sort_order])
    await connection.query(`
      INSERT INTO content_references
        (content_object_id, reference_type, contest_challenge_id)
      VALUES ($1, 'challenge_attachment', $2)`, [contentObjectId, challengeId])
  }
  const releaseBase = input.challenge.publish_at
    ? new Date(input.challenge.publish_at)
    : input.contestStartAt
  for (const hint of input.challenge.hints) {
    const releaseAfterSeconds = hint.release_at === null
      ? null
      : Math.max(0, Math.floor((new Date(hint.release_at).getTime() - releaseBase.getTime()) / 1000))
    await connection.query(`
      INSERT INTO challenge_template_hints
        (template_version_id, title, content, release_after_seconds, sort_order)
      VALUES ($1, $2, $3, $4, $5)`, [
      versionId,
      hint.title,
      hint.content,
      releaseAfterSeconds,
      hint.sort_order,
    ])
    await connection.query(`
      INSERT INTO challenge_hints
        (contest_challenge_id, title, content, release_at, sort_order)
      VALUES ($1, $2, $3, $4, $5)`, [
      challengeId,
      hint.title,
      hint.content,
      hint.release_at,
      hint.sort_order,
    ])
  }
}

async function writeAudit(connection: DatabaseExecutor, input: {
  actorId: string
  requestId: string
  action: string
  targetType: string
  targetId: string
  reason: string
  changes: Record<string, unknown>
}) {
  await connection.query(`
    INSERT INTO audit_events
      (actor_user_id, action, target_type, target_id, reason,
       outcome, request_id, changes, metadata)
    VALUES ($1, $2, $3, $4, $5, 'succeeded', $6, $7, '{}'::jsonb)`, [
    input.actorId,
    input.action,
    input.targetType,
    input.targetId,
    input.reason,
    input.requestId,
    input.changes,
  ])
}

function exportRecord(row: ExportRow): ContestPackageExportRecord {
  return {
    id: row.id,
    contestId: row.contest_id,
    packageObjectId: row.package_object_id,
    packageVersion: row.package_version,
    createdAt: row.created_at,
  }
}

function importRecord(row: ImportRow): ContestPackageImportRecord {
  return {
    id: row.id,
    packageObjectId: row.package_object_id,
    packageVersion: row.package_version,
    contestId: row.result_contest_id,
    createdAt: row.created_at,
  }
}

function importedSlug(source: string, contestId: string) {
  const suffix = `-${contestId.slice(0, 8)}`
  return `${source.slice(0, 100 - suffix.length).replace(/-+$/u, '')}${suffix}`
}

function parseRegistrationConstraints(value: unknown) {
  const domains = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { allowed_email_domains?: unknown }).allowed_email_domains
    : undefined
  return {
    allowedEmailDomains: Array.isArray(domains)
      ? domains.filter((domain): domain is string => typeof domain === 'string')
      : [],
  }
}

function isUniqueConflict(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
}
