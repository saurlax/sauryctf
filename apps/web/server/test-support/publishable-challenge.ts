import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'

export interface PublishableChallengeOptions {
  title?: string
  description?: string
  enabled?: boolean
  publishAt?: Date | null
  flagPolicy?: Record<string, unknown>
  scoringPolicy?: Record<string, unknown>
  instancePolicy?: Record<string, unknown>
}

export async function createPublishableChallenge(
  pool: Pool,
  contestId: string,
  actorId: string,
  options: PublishableChallengeOptions = {},
) {
  const suffix = randomUUID()
  const title = options.title ?? `Publishable challenge ${suffix}`
  const description = options.description ?? 'Complete challenge statement'
  const flagPolicy = options.flagPolicy ?? { type: 'static', digest: 'a'.repeat(64) }
  const scoringPolicy = options.scoringPolicy ?? { type: 'fixed-v1', points: 500 }
  const instancePolicy = options.instancePolicy ?? { type: 'none' }
  const template = await pool.query<{ id: string }>(
    `INSERT INTO challenge_templates (name, slug, created_by, latest_version)
     VALUES ($1, $2, $3, 1)
     RETURNING id`,
    [`Publishable template ${suffix}`, `publishable-${suffix}`, actorId],
  )
  const version = await pool.query<{ id: string }>(
    `INSERT INTO challenge_template_versions
       (template_id, version_number, title, category, description, flag_format,
        flag_policy, scoring_policy, instance_policy, created_by)
     VALUES ($1, 1, $2, 'web', $3, 'flag{...}', $4, $5, $6, $7)
     RETURNING id`,
    [template.rows[0]!.id, title, description, flagPolicy, scoringPolicy, instancePolicy, actorId],
  )
  const challenge = await pool.query<{ id: string }>(
    `INSERT INTO contest_challenges
       (contest_id, source_template_id, source_version_id, title, category,
        description, flag_format, flag_policy, scoring_policy, instance_policy,
        enabled, publish_at)
     VALUES ($1, $2, $3, $4, 'web', $5, 'flag{...}', $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      contestId,
      template.rows[0]!.id,
      version.rows[0]!.id,
      title,
      description,
      flagPolicy,
      scoringPolicy,
      instancePolicy,
      options.enabled ?? true,
      options.publishAt ?? null,
    ],
  )
  return {
    templateId: template.rows[0]!.id,
    versionId: version.rows[0]!.id,
    challengeId: challenge.rows[0]!.id,
  }
}
