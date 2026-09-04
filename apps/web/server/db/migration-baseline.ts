import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const migrationBaseline = [
  ['0000_control_plane_baseline', 1788242400000, '39a37e70c258ae00a1407c2594daafbb70b4e127062c39013bec64d683c3507b'],
  ['0001_identity', 1788245100000, '0c1e53c3c6d77b314f3ccfae9bc66ffc23529e8be6ec53a03e6d28cf85eb65db'],
  ['0002_notifications_outbox', 1788247800000, '64bfe2ce46ad72571a6ac71dfabdac93abd5a931f4470b0f08c0c59435fd9044'],
  ['0003_teams', 1788250500000, '95c124f751645133637f607d83081c874abf7370c055335f053e381457748171'],
  ['0004_contests', 1788253200000, '7eb9c8eaac087870a72105a901a769de0e987484d724587e1e874d8bd2e5ce2c'],
  ['0005_challenges', 1788255900000, '57abb3da58211c98d043aa78471c628d68580c94ec17c02e623211d50944d628'],
  ['0006_submissions_scoring', 1788258600000, '55809dc88f75623f17ae47f1eaa85f5eae9af9ded41396889e6ac679b7506b17'],
  ['0007_instances', 1788261300000, '1f7ddb9e32c343a5e96eb61410b02aabbb006a98560c97da97cc46842eff4af4'],
  ['0008_content_writeups_administration', 1788264000000, '47a47e3a86ffadc24d9a01e809a7ea104a1cc4c21979c313ddefdf04d1e2b5a5'],
  ['0009_team_locking', 1788266700000, '729f1d7d640d7f296ea333ed9c6558b0b00b61c12c0c9e5db311f5e0a43227d7'],
  ['0010_participation_registration', 1788269400000, '637e8f48266d12e844c21d27f742a4c306f7083325b7354dcbd3465e0eb5ba49'],
  ['0011_contest_configuration', 1788272100000, 'ff6b0644f9e1cc51325c6f4099258502daadfed78f514a5583adce0cd82d34d0'],
  ['0012_challenge_template_assets', 1788274800000, 'c4852539ddba85fdd2a7ac18c29bb159753e2c423fc78584f0aa5f7de6378f78'],
  ['0013_contest_challenge_snapshots', 1788277500000, '3e69ff56e29cab0f1b845ce56fa11012c7ad6b41c5753b57d35aeb6538d073e8'],
  ['0014_challenge_policy_types', 1788280200000, 'e43d53d0a495e6960976bc7884befb7167911542b78173ef6de22c51ab6ed906'],
  ['0015_submission_answer_protection', 1788282900000, '221c1d627e75fa5a721c422f24923eff8eb5f0a8912b182b4d2646147a6e24d0'],
  ['0016_cheat_clue_deduplication', 1788285600000, '8cf0d3b2812f2ca9a027b3e2e215e1ec1bd317da2e6e2f6a52bb5eee901d1527'],
  ['0017_instance_orphan_reports', 1788288300000, '82b21ffd430d6e7712dd7194b6de2f20e4e4a1ec5ee019371e022073c13880be'],
  ['0018_content_object_lifecycle', 1788291000000, '9630dfcca7ea29274f0c0e2e5d709653f4c6f63e13abf19ea144fa3e0f9d0596'],
  ['0019_platform_settings_default', 1788293700000, '896dd446ba128449f5b2c0edcba93de70230c0373ed63f1df297f0f17b5f5f26'],
  ['0020_operational_commands', 1788296400000, '7cfb4d98cf3296dc682538b2a590e43d07fe5206c446e9ac731c61c9135b7d90'],
  ['0021_data_retention', 1788299100000, '700d014a31b0a2b37e633d98141f8d498935129375c315f05c0df11ad5e1d5fd'],
] as const

// Update this build-time manifest whenever a new SQL migration is added. The
// takeover baseline above intentionally remains limited to legacy migrations.
export const currentMigrationNames = [
  ...migrationBaseline.map(([name]) => name),
  '0022_rate_limit_windows',
  '0023_dark_theme_default',
] as const

export type MigrationBaselineEntry = {
  name: string
  legacyCreatedAt: number
  sha256: string
}

export const criticalSchemaFingerprint = {
  relations: [
    'control_plane.runtime_metadata',
    'public.challenge_templates',
    'public.content_objects',
    'public.contests',
    'public.domain_outbox',
    'public.instance_jobs',
    'public.instances',
    'public.mail_deliveries',
    'public.operational_commands',
    'public.participations',
    'public.scoreboard_snapshots',
    'public.scoreboard_versions',
    'public.security_log_events',
    'public.solves',
    'public.submissions',
    'public.team_members',
    'public.teams',
    'public.users',
    'public.writeups',
  ],
  columns: [
    'control_plane.runtime_metadata.key:text',
    'public.content_objects.sha256_digest:bytea',
    'public.instance_jobs.fencing_token:bigint',
    'public.scoreboard_snapshots.version:bigint',
    'public.submissions.answer_digest:bytea',
    'public.users.id:uuid',
  ],
  indexes: [
    'public.content_objects_storage_key_unique',
    'public.instance_jobs_generation_operation_unique',
    'public.scoreboard_snapshots_scope_version_unique',
    'public.solves_participation_challenge_mode_unique',
    'public.submissions_request_id_unique',
    'public.team_members_user_unique',
    'public.users_email_normalized_unique',
    'public.users_username_normalized_unique',
  ],
} as const

export const defaultMigrationsDirectory = fileURLToPath(
  new URL('./migrations/postgresql', import.meta.url),
)

export function expectedMigrationBaseline(): MigrationBaselineEntry[] {
  return migrationBaseline.map(([name, legacyCreatedAt, sha256]) => ({ name, legacyCreatedAt, sha256 }))
}

export async function readMigrationBaselineFiles(
  directory = defaultMigrationsDirectory,
): Promise<MigrationBaselineEntry[]> {
  const journal = JSON.parse(await readFile(`${directory}/meta/_journal.json`, 'utf8')) as {
    entries: Array<{ tag: string, when: number }>
  }
  const filenames = (await readdir(directory))
    .filter(filename => /^\d{4}_.+\.sql$/u.test(filename))
    .filter(filename => migrationBaseline.some(([name]) => `${name}.sql` === filename))
    .sort()
  const entriesByName = new Map(journal.entries.map(entry => [entry.tag, entry.when]))

  return Promise.all(filenames.map(async (filename) => {
    const name = filename.slice(0, -4)
    const legacyCreatedAt = entriesByName.get(name)
    if (legacyCreatedAt === undefined) throw new Error(`迁移 ${name} 不在旧 journal 中`)
    const sql = await readFile(`${directory}/${filename}`)
    return {
      name,
      legacyCreatedAt,
      sha256: createHash('sha256').update(sql).digest('hex'),
    }
  }))
}

export function assertMigrationBaseline(actual: MigrationBaselineEntry[]): void {
  const expected = expectedMigrationBaseline()
  if (actual.length !== expected.length) {
    throw new Error(`历史迁移数量漂移：期望 ${expected.length}，实际 ${actual.length}`)
  }
  for (let index = 0; index < expected.length; index += 1) {
    const expectedEntry = expected[index]!
    const actualEntry = actual[index]!
    if (actualEntry.name !== expectedEntry.name) {
      throw new Error(`历史迁移顺序或名称漂移：位置 ${index}`)
    }
    if (actualEntry.legacyCreatedAt !== expectedEntry.legacyCreatedAt) {
      throw new Error(`旧 journal 时间漂移：${expectedEntry.name}`)
    }
    if (actualEntry.sha256 !== expectedEntry.sha256) {
      throw new Error(`历史迁移内容漂移：${expectedEntry.name}`)
    }
  }
}

export async function verifyMigrationBaselineFiles(
  directory = defaultMigrationsDirectory,
): Promise<void> {
  assertMigrationBaseline(await readMigrationBaselineFiles(directory))
}
