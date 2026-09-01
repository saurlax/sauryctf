import type { Pool, PoolClient } from 'pg'
import {
  ChallengeContentObjectUnavailableError,
  ChallengeTemplateNotFoundError,
  ChallengeTemplateSlugConflictError,
  ChallengeTemplateVersionConflictError,
  type ChallengeTemplateAssetCommand,
  type ChallengeTemplateHintRecord,
  type ChallengeTemplateDetail,
  type ChallengeTemplateRepository,
  type CreateChallengeTemplateCommand,
  type CreateChallengeTemplateVersionCommand,
} from '../../domains/challenges/repository'
import type { ChallengeCategory } from '../../../shared/contracts/challenges'

interface DetailRow {
  template_id: string
  name: string
  slug: string
  latest_version: number
  template_version: string
  template_created_at: Date
  template_updated_at: Date
  challenge_version_id: string
  version_number: number
  title: string
  category: ChallengeCategory
  description: string
  flag_format: string | null
  flag_policy: Record<string, unknown>
  scoring_policy: Record<string, unknown>
  instance_policy: Record<string, unknown>
  created_by: string
  version_created_at: Date
}

function isSlugConflict(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === '23505'
    && 'constraint' in error
    && error.constraint === 'challenge_templates_slug_unique'
}

export class PostgresChallengeTemplateRepository implements ChallengeTemplateRepository {
  constructor(private pool: Pool) {}

  async create(command: CreateChallengeTemplateCommand): Promise<ChallengeTemplateDetail> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      await this.assertAssetsAvailable(connection, command.assets)
      await connection.query(
        `INSERT INTO challenge_templates
           (id, name, slug, created_by, latest_version)
         VALUES ($1, $2, $3, $4, 1)`,
        [command.templateId, command.name, command.slug, command.actorId],
      )
      await this.insertVersion(connection, command.versionId, command.templateId, 1, command.actorId, command)
      await this.insertAssets(connection, command.versionId, command.assets)
      await this.insertHints(connection, command.versionId, command.hints)
      await this.writeAudit(connection, command.actorId, command.requestId, 'challenge.template.created',
        'challenge_template', command.templateId, null, {
          slug: command.slug,
          initial_version_id: command.versionId,
        })
      const result = await this.readWith(connection, command.templateId, 1)
      await connection.query('COMMIT')
      return result
    }
    catch (error) {
      await connection.query('ROLLBACK')
      if (isSlugConflict(error)) throw new ChallengeTemplateSlugConflictError()
      throw error
    }
    finally {
      connection.release()
    }
  }

  async createVersion(command: CreateChallengeTemplateVersionCommand): Promise<ChallengeTemplateDetail> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const current = await connection.query<{ latest_version: number, version: string }>(
        `SELECT latest_version, version::text
         FROM challenge_templates WHERE id = $1 FOR UPDATE`,
        [command.templateId],
      )
      if (!current.rows[0]) throw new ChallengeTemplateNotFoundError()
      if (Number(current.rows[0].version) !== command.expectedVersion) {
        throw new ChallengeTemplateVersionConflictError()
      }
      await this.assertAssetsAvailable(connection, command.assets)
      const versionNumber = current.rows[0].latest_version + 1
      await this.insertVersion(
        connection,
        command.versionId,
        command.templateId,
        versionNumber,
        command.actorId,
        command,
      )
      await this.insertAssets(connection, command.versionId, command.assets)
      await this.insertHints(connection, command.versionId, command.hints)
      const updated = await connection.query(
        `UPDATE challenge_templates
         SET latest_version = $2, version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND version = $3`,
        [command.templateId, versionNumber, command.expectedVersion],
      )
      if (updated.rowCount !== 1) throw new ChallengeTemplateVersionConflictError()
      await this.writeAudit(connection, command.actorId, command.requestId,
        'challenge.template.version_created', 'challenge_template_version', command.versionId,
        command.reason, {
          template_id: command.templateId,
          version_number: versionNumber,
          previous_version_number: current.rows[0].latest_version,
        })
      const result = await this.readWith(connection, command.templateId, versionNumber)
      await connection.query('COMMIT')
      return result
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
  }

  async read(templateId: string, versionNumber?: number): Promise<ChallengeTemplateDetail> {
    return this.readWith(this.pool, templateId, versionNumber)
  }

  private async readWith(
    connection: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    templateId: string,
    versionNumber?: number,
  ): Promise<ChallengeTemplateDetail> {
    const detail = await connection.query<DetailRow>(
      `SELECT template.id AS template_id, template.name, template.slug,
              template.latest_version, template.version::text AS template_version,
              template.created_at AS template_created_at,
              template.updated_at AS template_updated_at,
              challenge_version.id AS challenge_version_id,
              challenge_version.version_number, challenge_version.title,
              challenge_version.category::text, challenge_version.description,
              challenge_version.flag_format, challenge_version.flag_policy,
              challenge_version.scoring_policy, challenge_version.instance_policy,
              challenge_version.created_by,
              challenge_version.created_at AS version_created_at
       FROM challenge_templates template
       JOIN challenge_template_versions challenge_version
         ON challenge_version.template_id = template.id
        AND challenge_version.version_number = COALESCE($2, template.latest_version)
       WHERE template.id = $1`,
      [templateId, versionNumber ?? null],
    )
    const row = detail.rows[0]
    if (!row) throw new ChallengeTemplateNotFoundError()
    const assets = await connection.query<{
      id: string
      content_object_id: string
      display_name: string
      sort_order: number
    }>(
      `SELECT id, content_object_id, display_name, sort_order
       FROM challenge_template_assets
       WHERE template_version_id = $1
       ORDER BY sort_order, id`,
      [row.challenge_version_id],
    )
    const hints = await connection.query<{
      id: string
      title: string
      content: string
      release_after_seconds: number | null
      sort_order: number
    }>(
      `SELECT id, title, content, release_after_seconds, sort_order
       FROM challenge_template_hints
       WHERE template_version_id = $1
       ORDER BY sort_order, id`,
      [row.challenge_version_id],
    )
    return {
      template: {
        id: row.template_id,
        name: row.name,
        slug: row.slug,
        latestVersion: row.latest_version,
        version: Number(row.template_version),
        createdAt: row.template_created_at,
        updatedAt: row.template_updated_at,
      },
      challengeVersion: {
        id: row.challenge_version_id,
        templateId: row.template_id,
        versionNumber: row.version_number,
        title: row.title,
        category: row.category,
        description: row.description,
        flagFormat: row.flag_format,
        flagPolicy: row.flag_policy,
        scoringPolicy: row.scoring_policy,
        instancePolicy: row.instance_policy,
        assets: assets.rows.map(asset => ({
          id: asset.id,
          contentObjectId: asset.content_object_id,
          displayName: asset.display_name,
          sortOrder: asset.sort_order,
        })),
        hints: hints.rows.map((hint): ChallengeTemplateHintRecord => ({
          id: hint.id,
          title: hint.title,
          content: hint.content,
          releaseAfterSeconds: hint.release_after_seconds,
          sortOrder: hint.sort_order,
        })),
        createdBy: row.created_by,
        createdAt: row.version_created_at,
      },
    }
  }

  private async assertAssetsAvailable(connection: PoolClient, assets: ChallengeTemplateAssetCommand[]) {
    if (assets.length === 0) return
    const ids = assets.map(asset => asset.contentObjectId)
    const available = await connection.query<{ id: string }>(
      `SELECT id FROM content_objects
       WHERE id = ANY($1::uuid[]) AND status = 'committed' AND committed_at IS NOT NULL
       FOR KEY SHARE`,
      [ids],
    )
    const found = new Set(available.rows.map(row => row.id))
    const unavailable = ids.filter(id => !found.has(id))
    if (unavailable.length) throw new ChallengeContentObjectUnavailableError(unavailable)
  }

  private async insertVersion(
    connection: PoolClient,
    versionId: string,
    templateId: string,
    versionNumber: number,
    actorId: string,
    snapshot: CreateChallengeTemplateCommand | CreateChallengeTemplateVersionCommand,
  ) {
    await connection.query(
      `INSERT INTO challenge_template_versions
         (id, template_id, version_number, title, category, description,
          flag_format, flag_policy, scoring_policy, instance_policy, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        versionId,
        templateId,
        versionNumber,
        snapshot.title,
        snapshot.category,
        snapshot.description,
        snapshot.flagFormat,
        snapshot.flagPolicy,
        snapshot.scoringPolicy,
        snapshot.instancePolicy,
        actorId,
      ],
    )
  }

  private async insertAssets(
    connection: PoolClient,
    versionId: string,
    assets: ChallengeTemplateAssetCommand[],
  ) {
    for (const asset of assets) {
      await connection.query(
        `INSERT INTO challenge_template_assets
           (template_version_id, content_object_id, display_name, sort_order)
         VALUES ($1, $2, $3, $4)`,
        [versionId, asset.contentObjectId, asset.displayName, asset.sortOrder],
      )
    }
  }

  private async insertHints(
    connection: PoolClient,
    versionId: string,
    hints: CreateChallengeTemplateCommand['hints'],
  ) {
    for (const hint of hints) {
      await connection.query(
        `INSERT INTO challenge_template_hints
           (template_version_id, title, content, release_after_seconds, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [versionId, hint.title, hint.content, hint.releaseAfterSeconds, hint.sortOrder],
      )
    }
  }

  private async writeAudit(
    connection: PoolClient,
    actorId: string,
    requestId: string,
    action: string,
    targetType: string,
    targetId: string,
    reason: string | null,
    changes: Record<string, unknown>,
  ) {
    await connection.query(
      `INSERT INTO audit_events
         (actor_user_id, action, target_type, target_id, reason,
          outcome, request_id, changes, metadata)
       VALUES ($1, $2, $3, $4, $5, 'succeeded', $6, $7, '{}')`,
      [actorId, action, targetType, targetId, reason, requestId, changes],
    )
  }
}
