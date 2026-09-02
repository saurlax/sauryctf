import type { MonitoringItem, MonitoringKind, MonitoringListRequest } from '../../../shared/contracts/monitoring'
import type { MonitoringRepository } from '../../domains/administration/monitoring'
import type { DatabaseExecutor } from './executor'

interface MonitoringRow {
  kind: MonitoringKind
  id: string
  contest_id: string | null
  challenge_id: string | null
  team_id: string | null
  status: string
  fact_at: Date
  worker_observed_at: Date | null
  details: Record<string, string | number | boolean | null>
}

type QueryExecutor = Pick<DatabaseExecutor, 'query'>

export class PostgresMonitoringRepository implements MonitoringRepository {
  constructor(private readonly database: QueryExecutor) {}

  async list(query: MonitoringListRequest, now: Date, workerStaleAfterMs: number): Promise<MonitoringItem[]> {
    const result = await this.database.query<MonitoringRow>(sqlFor(query.kind), [
      query.contest_id ?? null,
      query.challenge_id ?? null,
      query.team_id ?? null,
      query.status ?? null,
      query.limit,
    ])
    return result.rows.map((row) => {
      const observedAt = row.worker_observed_at
      const activeInstance = row.kind === 'instances'
        && (row.details.desired_state === 'running' || ['running', 'starting', 'stopping'].includes(row.status))
      const observationReference = observedAt ?? row.fact_at
      const stale = activeInstance && now.getTime() - observationReference.getTime() > workerStaleAfterMs
      return {
        kind: row.kind,
        id: row.id,
        contest_id: row.contest_id,
        challenge_id: row.challenge_id,
        team_id: row.team_id,
        status: row.status,
        fact_at: row.fact_at.toISOString(),
        worker_observed_at: observedAt?.toISOString() ?? null,
        worker_observation_stale: stale,
        details: row.details,
      }
    })
  }
}

function sqlFor(kind: MonitoringKind): string {
  const queries: Record<MonitoringKind, string> = {
    submissions: `SELECT 'submissions' AS kind, submission.id::text, submission.contest_id::text,
      submission.contest_challenge_id::text AS challenge_id, participation.team_id::text,
      submission.result::text AS status, submission.submitted_at AS fact_at,
      NULL::timestamptz AS worker_observed_at,
      jsonb_build_object('mode', submission.mode::text, 'participation_id', submission.participation_id::text,
        'user_id', submission.user_id::text, 'request_id', submission.request_id) AS details
      FROM submissions AS submission JOIN participations AS participation ON participation.id = submission.participation_id
      WHERE ($1::uuid IS NULL OR submission.contest_id = $1) AND ($2::uuid IS NULL OR submission.contest_challenge_id = $2)
        AND ($3::uuid IS NULL OR participation.team_id = $3) AND ($4::text IS NULL OR submission.result::text = $4)
      ORDER BY submission.submitted_at DESC, submission.id DESC LIMIT $5`,
    cheat_clues: `SELECT 'cheat_clues' AS kind, clue.id::text, clue.contest_id::text,
      clue.contest_challenge_id::text AS challenge_id, participation.team_id::text,
      clue.status::text, clue.created_at AS fact_at, NULL::timestamptz AS worker_observed_at,
      jsonb_build_object('clue_type', clue.clue_type, 'participation_id', clue.participation_id::text) AS details
      FROM cheat_clues AS clue LEFT JOIN participations AS participation ON participation.id = clue.participation_id
      WHERE ($1::uuid IS NULL OR clue.contest_id = $1) AND ($2::uuid IS NULL OR clue.contest_challenge_id = $2)
        AND ($3::uuid IS NULL OR participation.team_id = $3) AND ($4::text IS NULL OR clue.status::text = $4)
      ORDER BY clue.created_at DESC, clue.id DESC LIMIT $5`,
    instances: `SELECT 'instances' AS kind, instance.id::text, instance.contest_id::text,
      instance.contest_challenge_id::text AS challenge_id, participation.team_id::text,
      instance.observed_state::text AS status, instance.updated_at AS fact_at, instance.last_observed_at AS worker_observed_at,
      jsonb_build_object('provider', instance.provider::text, 'desired_state', instance.desired_state::text,
        'desired_generation', instance.desired_generation, 'observed_generation', instance.observed_generation,
        'expires_at', instance.expires_at::text, 'last_error_code', instance.last_error_code) AS details
      FROM instances AS instance JOIN participations AS participation ON participation.id = instance.participation_id
      WHERE ($1::uuid IS NULL OR instance.contest_id = $1) AND ($2::uuid IS NULL OR instance.contest_challenge_id = $2)
        AND ($3::uuid IS NULL OR participation.team_id = $3) AND ($4::text IS NULL OR instance.observed_state::text = $4)
      ORDER BY instance.updated_at DESC, instance.id DESC LIMIT $5`,
    instance_jobs: `SELECT 'instance_jobs' AS kind, job.id::text, instance.contest_id::text,
      instance.contest_challenge_id::text AS challenge_id, participation.team_id::text,
      job.status::text, COALESCE(job.finished_at, job.started_at, job.created_at) AS fact_at,
      instance.last_observed_at AS worker_observed_at,
      jsonb_build_object('operation', job.operation::text, 'instance_id', job.instance_id::text,
        'attempt_count', job.attempt_count, 'max_attempts', job.max_attempts,
        'error_code', job.error_code, 'available_at', job.available_at::text, 'lease_until', job.lease_until::text) AS details
      FROM instance_jobs AS job JOIN instances AS instance ON instance.id = job.instance_id
      JOIN participations AS participation ON participation.id = instance.participation_id
      WHERE ($1::uuid IS NULL OR instance.contest_id = $1) AND ($2::uuid IS NULL OR instance.contest_challenge_id = $2)
        AND ($3::uuid IS NULL OR participation.team_id = $3) AND ($4::text IS NULL OR job.status::text = $4)
      ORDER BY job.created_at DESC, job.id DESC LIMIT $5`,
    announcements: `SELECT 'announcements' AS kind, announcement.id::text, announcement.contest_id::text,
      NULL::text AS challenge_id, NULL::text AS team_id,
      CASE WHEN announcement.withdrawn_at IS NOT NULL THEN 'withdrawn'
        WHEN announcement.publish_at > clock_timestamp() THEN 'scheduled' ELSE 'published' END AS status,
      announcement.updated_at AS fact_at, NULL::timestamptz AS worker_observed_at,
      jsonb_build_object('title', announcement.title, 'publish_at', announcement.publish_at::text) AS details
      FROM announcements AS announcement WHERE ($1::uuid IS NULL OR announcement.contest_id = $1)
        AND $2::uuid IS NULL AND $3::uuid IS NULL
        AND ($4::text IS NULL OR (CASE WHEN announcement.withdrawn_at IS NOT NULL THEN 'withdrawn'
          WHEN announcement.publish_at > clock_timestamp() THEN 'scheduled' ELSE 'published' END) = $4)
      ORDER BY announcement.updated_at DESC, announcement.id DESC LIMIT $5`,
    notifications: `SELECT 'notifications' AS kind, notification.id::text, NULL::text AS contest_id,
      NULL::text AS challenge_id, NULL::text AS team_id,
      CASE WHEN notification.read_at IS NULL THEN 'unread' ELSE 'read' END AS status,
      notification.created_at AS fact_at, NULL::timestamptz AS worker_observed_at,
      jsonb_build_object('user_id', notification.user_id::text, 'template_key', notification.template_key,
        'read_at', notification.read_at::text) AS details
      FROM notifications AS notification WHERE $1::uuid IS NULL AND $2::uuid IS NULL AND $3::uuid IS NULL
        AND ($4::text IS NULL OR (CASE WHEN notification.read_at IS NULL THEN 'unread' ELSE 'read' END) = $4)
      ORDER BY notification.created_at DESC, notification.id DESC LIMIT $5`,
    mail_deliveries: `SELECT 'mail_deliveries' AS kind, delivery.id::text, NULL::text AS contest_id,
      NULL::text AS challenge_id, NULL::text AS team_id, delivery.status::text,
      delivery.updated_at AS fact_at, NULL::timestamptz AS worker_observed_at,
      jsonb_build_object('recipient', CASE WHEN position('@' IN delivery.recipient) > 1
          THEN left(delivery.recipient, 1) || '***' || substring(delivery.recipient FROM position('@' IN delivery.recipient))
          ELSE '***' END,
        'template_key', delivery.template_key, 'locale', delivery.locale::text,
        'attempt_count', delivery.attempt_count, 'max_attempts', delivery.max_attempts,
        'available_at', delivery.available_at::text, 'sent_at', delivery.sent_at::text,
        'has_error', delivery.last_error IS NOT NULL) AS details
      FROM mail_deliveries AS delivery WHERE $1::uuid IS NULL AND $2::uuid IS NULL AND $3::uuid IS NULL
        AND ($4::text IS NULL OR delivery.status::text = $4)
      ORDER BY delivery.updated_at DESC, delivery.id DESC LIMIT $5`,
    writeups: `SELECT 'writeups' AS kind, writeup.id::text, writeup.contest_id::text,
      NULL::text AS challenge_id, participation.team_id::text, writeup.status::text,
      writeup.updated_at AS fact_at, NULL::timestamptz AS worker_observed_at,
      jsonb_build_object('participation_id', writeup.participation_id::text,
        'current_version', writeup.current_version, 'submitted_version', writeup.submitted_version,
        'submitted_at', writeup.submitted_at::text, 'reviewed_at', writeup.reviewed_at::text) AS details
      FROM writeups AS writeup JOIN participations AS participation ON participation.id = writeup.participation_id
      WHERE ($1::uuid IS NULL OR writeup.contest_id = $1) AND $2::uuid IS NULL
        AND ($3::uuid IS NULL OR participation.team_id = $3) AND ($4::text IS NULL OR writeup.status::text = $4)
      ORDER BY writeup.updated_at DESC, writeup.id DESC LIMIT $5`,
    audit_events: `SELECT 'audit_events' AS kind, audit.id::text,
      CASE WHEN audit.target_type = 'contest' THEN audit.target_id::text ELSE NULL END AS contest_id,
      CASE WHEN audit.target_type = 'contest_challenge' THEN audit.target_id::text ELSE NULL END AS challenge_id,
      CASE WHEN audit.target_type = 'team' THEN audit.target_id::text ELSE NULL END AS team_id,
      audit.outcome::text AS status, audit.occurred_at AS fact_at, NULL::timestamptz AS worker_observed_at,
      jsonb_build_object('actor_user_id', audit.actor_user_id::text, 'action', audit.action,
        'target_type', audit.target_type, 'target_id', audit.target_id::text, 'request_id', audit.request_id,
        'reason', audit.reason) AS details
      FROM audit_events AS audit WHERE ($1::uuid IS NULL OR ((audit.target_type = 'contest' AND audit.target_id = $1)
          OR audit.metadata->>'contest_id' = $1::text))
        AND ($2::uuid IS NULL OR ((audit.target_type = 'contest_challenge' AND audit.target_id = $2)
          OR audit.metadata->>'challenge_id' = $2::text))
        AND ($3::uuid IS NULL OR ((audit.target_type = 'team' AND audit.target_id = $3)
          OR audit.metadata->>'team_id' = $3::text))
        AND ($4::text IS NULL OR audit.outcome::text = $4)
      ORDER BY audit.occurred_at DESC, audit.id DESC LIMIT $5`,
  }
  return queries[kind]
}
