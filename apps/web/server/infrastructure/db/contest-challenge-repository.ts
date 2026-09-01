import { isDeepStrictEqual } from 'node:util'
import type { Pool, PoolClient } from 'pg'
import type { ChallengeCategory } from '../../../shared/contracts/challenges'
import {
  ContestChallengeArchivedError,
  ContestChallengeConfigurationLockedError,
  ContestChallengeNotFoundError,
  ContestChallengeRevisionNotAllowedError,
  ContestChallengeRevisionUnchangedError,
  ContestChallengeTemplateVersionNotFoundError,
  ContestChallengeTitleConflictError,
  ContestChallengeVersionConflictError,
  type ContestChallengeAssetCommand,
  type ContestChallengeAssetRecord,
  type ContestChallengeHintCommand,
  type ContestChallengeHintRecord,
  type ContestChallengeRecord,
  type ContestChallengeRepository,
  type MountContestChallengeCommand,
  type ReviseContestChallengeCommand,
} from '../../domains/challenges/contest-challenge-repository'
import { ChallengeContentObjectUnavailableError } from '../../domains/challenges/repository'

type ContestStatus = 'draft' | 'published' | 'archived'

interface ChallengeRow {
  id: string
  contest_id: string
  source_template_id: string
  source_version_id: string
  source_version_number: number
  snapshot_revision: number
  title: string
  category: ChallengeCategory
  description: string
  flag_format: string | null
  flag_policy: Record<string, unknown>
  scoring_policy: Record<string, unknown>
  instance_policy: Record<string, unknown>
  enabled: boolean
  publish_at: Date | null
  close_at: Date | null
  submission_limit: number | null
  sort_order: number
  version: string
  created_at: Date
  updated_at: Date
}

interface TemplateVersionRow {
  id: string
  template_id: string
  version_number: number
  title: string
  category: ChallengeCategory
  description: string
  flag_format: string | null
  flag_policy: Record<string, unknown>
  scoring_policy: Record<string, unknown>
  instance_policy: Record<string, unknown>
}

function isTitleConflict(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: string }).code === '23505'
    && (error as { constraint?: string }).constraint === 'contest_challenges_contest_title_unique'
}

export class PostgresContestChallengeRepository implements ContestChallengeRepository {
  constructor(private pool: Pool) {}

  async mount(command: MountContestChallengeCommand): Promise<ContestChallengeRecord> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const contest = await connection.query<{
        publication_status: ContestStatus
        start_at: Date
      }>(
        `SELECT publication_status::text, start_at
         FROM contests WHERE id = $1 FOR UPDATE`,
        [command.contestId],
      )
      if (!contest.rows[0]) throw new ContestChallengeNotFoundError()
      if (contest.rows[0].publication_status !== 'draft') {
        throw new ContestChallengeConfigurationLockedError()
      }

      const version = await connection.query<TemplateVersionRow>(
        `SELECT id, template_id, version_number, title, category::text,
                description, flag_format, flag_policy, scoring_policy, instance_policy
         FROM challenge_template_versions
         WHERE id = $1
         FOR KEY SHARE`,
        [command.templateVersionId],
      )
      const template = version.rows[0]
      if (!template) throw new ContestChallengeTemplateVersionNotFoundError()

      const assets = await this.readTemplateAssets(connection, template.id)
      const hints = await this.readTemplateHints(connection, template.id)
      await this.assertAssetsAvailable(connection, assets)

      await connection.query(
        `INSERT INTO contest_challenges
           (id, contest_id, source_template_id, source_version_id,
            snapshot_revision, title, category, description, flag_format,
            flag_policy, scoring_policy, instance_policy, enabled, publish_at,
            close_at, submission_limit, sort_order)
         VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11,
                 $12, $13, $14, $15, $16)`,
        [
          command.challengeId,
          command.contestId,
          template.template_id,
          template.id,
          template.title,
          template.category,
          template.description,
          template.flag_format,
          template.flag_policy,
          template.scoring_policy,
          template.instance_policy,
          command.enabled,
          command.publishAt,
          command.closeAt,
          command.submissionLimit,
          command.sortOrder,
        ],
      )
      await this.insertAssets(connection, command.challengeId, assets)
      const hintBase = command.publishAt ?? contest.rows[0].start_at
      await this.insertHints(connection, command.challengeId, hints.map(hint => ({
        title: hint.title,
        content: hint.content,
        releaseAt: hint.releaseAfterSeconds === null
          ? null
          : new Date(hintBase.getTime() + hint.releaseAfterSeconds * 1000),
        sortOrder: hint.sortOrder,
      })))
      await this.writeAudit(connection, {
        actorId: command.actorId,
        requestId: command.requestId,
        challengeId: command.challengeId,
        action: 'contest.challenge.mounted',
        reason: null,
        changes: {
          contest_id: command.contestId,
          source_template_id: template.template_id,
          source_version_id: template.id,
          source_version_number: template.version_number,
          snapshot_revision: 1,
        },
      })
      const result = await this.readWith(connection, command.contestId, command.challengeId)
      await connection.query('COMMIT')
      return result
    }
    catch (error) {
      await connection.query('ROLLBACK')
      if (isTitleConflict(error)) throw new ContestChallengeTitleConflictError()
      throw error
    }
    finally {
      connection.release()
    }
  }

  async read(contestId: string, challengeId: string): Promise<ContestChallengeRecord> {
    return this.readWith(this.pool, contestId, challengeId)
  }

  async revise(command: ReviseContestChallengeCommand): Promise<ContestChallengeRecord> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const locked = await connection.query<{
        publication_status: ContestStatus
        version: string
      }>(
        `SELECT contest.publication_status::text, challenge.version::text
         FROM contest_challenges challenge
         JOIN contests contest ON contest.id = challenge.contest_id
         WHERE challenge.id = $1 AND challenge.contest_id = $2
         FOR UPDATE OF challenge, contest`,
        [command.challengeId, command.contestId],
      )
      const state = locked.rows[0]
      if (!state) throw new ContestChallengeNotFoundError()
      if (state.publication_status === 'archived') throw new ContestChallengeArchivedError()
      if (state.publication_status !== 'published') throw new ContestChallengeRevisionNotAllowedError()
      if (Number(state.version) !== command.expectedVersion) {
        throw new ContestChallengeVersionConflictError()
      }

      const current = await this.readWith(connection, command.contestId, command.challengeId)
      const next = {
        title: command.title ?? current.title,
        category: command.category ?? current.category,
        description: command.description ?? current.description,
        flagFormat: command.flagFormat === undefined ? current.flagFormat : command.flagFormat,
        flagPolicy: command.flagPolicy ?? current.flagPolicy,
        scoringPolicy: command.scoringPolicy ?? current.scoringPolicy,
        instancePolicy: command.instancePolicy ?? current.instancePolicy,
        assets: command.assets ?? current.assets.map(this.assetCommand),
        hints: command.hints ?? current.hints.map(this.hintCommand),
        enabled: command.enabled ?? current.enabled,
        publishAt: command.publishAt === undefined ? current.publishAt : command.publishAt,
        closeAt: command.closeAt === undefined ? current.closeAt : command.closeAt,
        submissionLimit: command.submissionLimit === undefined
          ? current.submissionLimit
          : command.submissionLimit,
        sortOrder: command.sortOrder ?? current.sortOrder,
      }
      const before = this.snapshotValue(current)
      const after = this.snapshotValue(next)
      if (isDeepStrictEqual(before, after)) throw new ContestChallengeRevisionUnchangedError()
      await this.assertAssetsAvailable(connection, next.assets)

      await connection.query(`SELECT set_config('sauryctf.challenge_revision', 'allowed', true)`)
      const updated = await connection.query(
        `UPDATE contest_challenges
         SET snapshot_revision = snapshot_revision + 1,
             title = $3, category = $4, description = $5, flag_format = $6,
             flag_policy = $7, scoring_policy = $8, instance_policy = $9,
             enabled = $10, publish_at = $11, close_at = $12,
             submission_limit = $13, sort_order = $14,
             version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND contest_id = $2 AND version = $15`,
        [
          command.challengeId,
          command.contestId,
          next.title,
          next.category,
          next.description,
          next.flagFormat,
          next.flagPolicy,
          next.scoringPolicy,
          next.instancePolicy,
          next.enabled,
          next.publishAt,
          next.closeAt,
          next.submissionLimit,
          next.sortOrder,
          command.expectedVersion,
        ],
      )
      if (updated.rowCount !== 1) throw new ContestChallengeVersionConflictError()

      if (command.assets) {
        await connection.query('DELETE FROM challenge_assets WHERE contest_challenge_id = $1', [command.challengeId])
        await this.insertAssets(connection, command.challengeId, next.assets)
      }
      if (command.hints) {
        await connection.query('DELETE FROM challenge_hints WHERE contest_challenge_id = $1', [command.challengeId])
        await this.insertHints(connection, command.challengeId, next.hints)
      }

      const snapshotRevision = current.snapshotRevision + 1
      const resourceVersion = current.version + 1
      const changedFields = Object.keys(after).filter(key => !isDeepStrictEqual(
        before[key as keyof typeof before],
        after[key as keyof typeof after],
      ))
      await this.writeAudit(connection, {
        actorId: command.actorId,
        requestId: command.requestId,
        challengeId: command.challengeId,
        action: 'contest.challenge.snapshot_revised',
        reason: command.reason,
        changes: {
          contest_id: command.contestId,
          previous_snapshot_revision: current.snapshotRevision,
          snapshot_revision: snapshotRevision,
          resource_version: resourceVersion,
          changed_fields: changedFields,
        },
      })
      await connection.query(
        `INSERT INTO domain_outbox
           (aggregate_type, aggregate_id, event_type, event_version,
            dedupe_key, payload)
         VALUES ('contest_challenge', $1, 'contest.challenge.snapshot_revised', $2,
                 $3, $4)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [
          command.challengeId,
          snapshotRevision,
          `contest-challenge:${command.challengeId}:snapshot-revised:r${snapshotRevision}`,
          {
            schema_version: 1,
            contest_id: command.contestId,
            contest_challenge_id: command.challengeId,
            snapshot_revision: snapshotRevision,
            resource_version: resourceVersion,
          },
        ],
      )
      const result = await this.readWith(connection, command.contestId, command.challengeId)
      await connection.query('COMMIT')
      return result
    }
    catch (error) {
      await connection.query('ROLLBACK')
      if (isTitleConflict(error)) throw new ContestChallengeTitleConflictError()
      throw error
    }
    finally {
      connection.release()
    }
  }

  private async readWith(
    connection: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    contestId: string,
    challengeId: string,
  ): Promise<ContestChallengeRecord> {
    const result = await connection.query<ChallengeRow>(
      `SELECT challenge.id, challenge.contest_id, challenge.source_template_id,
              challenge.source_version_id, source.version_number AS source_version_number,
              challenge.snapshot_revision, challenge.title, challenge.category::text,
              challenge.description, challenge.flag_format, challenge.flag_policy,
              challenge.scoring_policy, challenge.instance_policy, challenge.enabled,
              challenge.publish_at, challenge.close_at, challenge.submission_limit,
              challenge.sort_order, challenge.version::text,
              challenge.created_at, challenge.updated_at
       FROM contest_challenges challenge
       JOIN challenge_template_versions source ON source.id = challenge.source_version_id
       WHERE challenge.contest_id = $1 AND challenge.id = $2`,
      [contestId, challengeId],
    )
    const row = result.rows[0]
    if (!row) throw new ContestChallengeNotFoundError()
    const [assets, hints] = await Promise.all([
      this.readAssets(connection, challengeId),
      this.readHints(connection, challengeId),
    ])
    return {
      id: row.id,
      contestId: row.contest_id,
      sourceTemplateId: row.source_template_id,
      sourceVersionId: row.source_version_id,
      sourceVersionNumber: row.source_version_number,
      snapshotRevision: row.snapshot_revision,
      title: row.title,
      category: row.category,
      description: row.description,
      flagFormat: row.flag_format,
      flagPolicy: row.flag_policy,
      scoringPolicy: row.scoring_policy,
      instancePolicy: row.instance_policy,
      assets,
      hints,
      enabled: row.enabled,
      publishAt: row.publish_at,
      closeAt: row.close_at,
      submissionLimit: row.submission_limit,
      sortOrder: row.sort_order,
      version: Number(row.version),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private async readAssets(
    connection: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    challengeId: string,
  ): Promise<ContestChallengeAssetRecord[]> {
    const result = await connection.query<{
      id: string
      content_object_id: string
      display_name: string
      sort_order: number
    }>(
      `SELECT id, content_object_id, display_name, sort_order
       FROM challenge_assets WHERE contest_challenge_id = $1
       ORDER BY sort_order, id`,
      [challengeId],
    )
    return result.rows.map(asset => ({
      id: asset.id,
      contentObjectId: asset.content_object_id,
      displayName: asset.display_name,
      sortOrder: asset.sort_order,
    }))
  }

  private async readHints(
    connection: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    challengeId: string,
  ): Promise<ContestChallengeHintRecord[]> {
    const result = await connection.query<{
      id: string
      title: string
      content: string
      release_at: Date | null
      sort_order: number
    }>(
      `SELECT id, title, content, release_at, sort_order
       FROM challenge_hints WHERE contest_challenge_id = $1
       ORDER BY sort_order, id`,
      [challengeId],
    )
    return result.rows.map(hint => ({
      id: hint.id,
      title: hint.title,
      content: hint.content,
      releaseAt: hint.release_at,
      sortOrder: hint.sort_order,
    }))
  }

  private async readTemplateAssets(
    connection: PoolClient,
    versionId: string,
  ): Promise<ContestChallengeAssetCommand[]> {
    const result = await connection.query<{
      content_object_id: string
      display_name: string
      sort_order: number
    }>(
      `SELECT content_object_id, display_name, sort_order
       FROM challenge_template_assets WHERE template_version_id = $1
       ORDER BY sort_order, id`,
      [versionId],
    )
    return result.rows.map(asset => ({
      contentObjectId: asset.content_object_id,
      displayName: asset.display_name,
      sortOrder: asset.sort_order,
    }))
  }

  private async readTemplateHints(connection: PoolClient, versionId: string) {
    const result = await connection.query<{
      title: string
      content: string
      release_after_seconds: number | null
      sort_order: number
    }>(
      `SELECT title, content, release_after_seconds, sort_order
       FROM challenge_template_hints WHERE template_version_id = $1
       ORDER BY sort_order, id`,
      [versionId],
    )
    return result.rows.map(hint => ({
      title: hint.title,
      content: hint.content,
      releaseAfterSeconds: hint.release_after_seconds,
      sortOrder: hint.sort_order,
    }))
  }

  private async assertAssetsAvailable(
    connection: PoolClient,
    assets: ContestChallengeAssetCommand[],
  ) {
    if (!assets.length) return
    const ids = assets.map(asset => asset.contentObjectId)
    const result = await connection.query<{ id: string }>(
      `SELECT id FROM content_objects
       WHERE id = ANY($1::uuid[]) AND status = 'committed' AND committed_at IS NOT NULL
       FOR KEY SHARE`,
      [ids],
    )
    const found = new Set(result.rows.map(row => row.id))
    const unavailable = ids.filter(id => !found.has(id))
    if (unavailable.length) throw new ChallengeContentObjectUnavailableError(unavailable)
  }

  private async insertAssets(
    connection: PoolClient,
    challengeId: string,
    assets: ContestChallengeAssetCommand[],
  ) {
    for (const asset of assets) {
      await connection.query(
        `INSERT INTO challenge_assets
           (contest_challenge_id, content_object_id, display_name, sort_order)
         VALUES ($1, $2, $3, $4)`,
        [challengeId, asset.contentObjectId, asset.displayName, asset.sortOrder],
      )
    }
  }

  private async insertHints(
    connection: PoolClient,
    challengeId: string,
    hints: ContestChallengeHintCommand[],
  ) {
    for (const hint of hints) {
      await connection.query(
        `INSERT INTO challenge_hints
           (contest_challenge_id, title, content, release_at, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [challengeId, hint.title, hint.content, hint.releaseAt, hint.sortOrder],
      )
    }
  }

  private assetCommand(asset: ContestChallengeAssetRecord): ContestChallengeAssetCommand {
    return {
      contentObjectId: asset.contentObjectId,
      displayName: asset.displayName,
      sortOrder: asset.sortOrder,
    }
  }

  private hintCommand(hint: ContestChallengeHintRecord): ContestChallengeHintCommand {
    return {
      title: hint.title,
      content: hint.content,
      releaseAt: hint.releaseAt,
      sortOrder: hint.sortOrder,
    }
  }

  private snapshotValue(input: {
    title: string
    category: ChallengeCategory
    description: string
    flagFormat: string | null
    flagPolicy: Record<string, unknown>
    scoringPolicy: Record<string, unknown>
    instancePolicy: Record<string, unknown>
    assets: ContestChallengeAssetCommand[] | ContestChallengeAssetRecord[]
    hints: ContestChallengeHintCommand[] | ContestChallengeHintRecord[]
    enabled: boolean
    publishAt: Date | null
    closeAt: Date | null
    submissionLimit: number | null
    sortOrder: number
  }) {
    return {
      title: input.title,
      category: input.category,
      description: input.description,
      flagFormat: input.flagFormat,
      flagPolicy: input.flagPolicy,
      scoringPolicy: input.scoringPolicy,
      instancePolicy: input.instancePolicy,
      assets: input.assets.map(asset => ({
        contentObjectId: asset.contentObjectId,
        displayName: asset.displayName,
        sortOrder: asset.sortOrder,
      })),
      hints: input.hints.map(hint => ({
        title: hint.title,
        content: hint.content,
        releaseAt: hint.releaseAt?.toISOString() ?? null,
        sortOrder: hint.sortOrder,
      })),
      enabled: input.enabled,
      publishAt: input.publishAt?.toISOString() ?? null,
      closeAt: input.closeAt?.toISOString() ?? null,
      submissionLimit: input.submissionLimit,
      sortOrder: input.sortOrder,
    }
  }

  private async writeAudit(connection: PoolClient, input: {
    actorId: string
    requestId: string
    challengeId: string
    action: string
    reason: string | null
    changes: Record<string, unknown>
  }) {
    await connection.query(
      `INSERT INTO audit_events
         (actor_user_id, action, target_type, target_id, reason,
          outcome, request_id, changes, metadata)
       VALUES ($1, $2, 'contest_challenge', $3, $4,
               'succeeded', $5, $6, '{}')`,
      [input.actorId, input.action, input.challengeId, input.reason, input.requestId, input.changes],
    )
  }
}
