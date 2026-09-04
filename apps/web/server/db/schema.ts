import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const controlPlaneSchema = pgSchema('control_plane')

export const runtimeMetadata = controlPlaneSchema.table('runtime_metadata', {
  key: text().primaryKey(),
  value: jsonb().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
})

const bytea = customType<{ data: Buffer }>({
  dataType: () => 'bytea',
})

export const userStatus = pgEnum('user_status', ['active', 'banned', 'deleted'])
export const globalRole = pgEnum('global_role', ['user', 'organizer', 'admin'])
export const emailTokenPurpose = pgEnum('email_token_purpose', ['verify_email', 'reset_password'])
export const mailDeliveryStatus = pgEnum('mail_delivery_status', [
  'pending',
  'leased',
  'retry_wait',
  'sent',
  'failed',
])
export const systemLocale = pgEnum('system_locale', ['zh-CN', 'en'])
export const teamMemberRole = pgEnum('team_member_role', ['member', 'captain'])
export const contestPublicationStatus = pgEnum('contest_publication_status', ['draft', 'published', 'archived'])
export const contestTimePhase = pgEnum('contest_time_phase', ['upcoming', 'running', 'ended'])
export const contestVisibility = pgEnum('contest_visibility', ['public', 'private'])
export const registrationStrategy = pgEnum('registration_strategy', ['review', 'auto_accept'])
export const participationStatus = pgEnum('participation_status', ['pending', 'accepted', 'rejected', 'withdrawn'])
export const contestEventType = pgEnum('contest_event_type', [
  'announcement_published',
  'challenge_published',
  'hint_published',
  'first_solve',
  'scoreboard_frozen',
  'contest_phase_changed',
])
export const challengeCategory = pgEnum('challenge_category', [
  'web',
  'pwn',
  'crypto',
  'reverse',
  'misc',
  'forensics',
])
export const contentObjectStatus = pgEnum('content_object_status', ['temporary', 'committed', 'quarantined', 'deleted'])
export const submissionMode = pgEnum('submission_mode', ['official', 'practice'])
export const submissionResult = pgEnum('submission_result', [
  'incorrect',
  'correct',
  'already_solved',
  'rate_limited',
  'ineligible',
])
export const cheatClueStatus = pgEnum('cheat_clue_status', ['open', 'reviewing', 'dismissed', 'confirmed'])
export const scoreboardView = pgEnum('scoreboard_view', ['public', 'internal'])
export const instanceProvider = pgEnum('instance_provider', ['docker', 'kubernetes'])
export const instanceDesiredState = pgEnum('instance_desired_state', ['running', 'stopped'])
export const instanceObservedState = pgEnum('instance_observed_state', [
  'pending',
  'starting',
  'running',
  'stopping',
  'stopped',
  'failed',
  'unknown',
])
export const instanceJobOperation = pgEnum('instance_job_operation', ['ensure', 'inspect', 'destroy', 'reconcile'])
export const instanceJobStatus = pgEnum('instance_job_status', [
  'ready',
  'leased',
  'retry_wait',
  'succeeded',
  'dead',
  'cancelled',
  'superseded',
])
export const instanceAttemptOutcome = pgEnum('instance_attempt_outcome', [
  'running',
  'succeeded',
  'retryable_error',
  'permanent_error',
  'cancelled',
  'lease_lost',
])
export const writeupStatus = pgEnum('writeup_status', ['draft', 'submitted', 'approved', 'changes_requested'])
export const transferStatus = pgEnum('transfer_status', ['queued', 'validating', 'processing', 'succeeded', 'failed'])
export const platformTheme = pgEnum('platform_theme', ['system', 'light', 'dark'])
export const authenticationMode = pgEnum('authentication_mode', ['password_only'])
export const contentReferenceType = pgEnum('content_reference_type', [
  'challenge_attachment',
  'writeup_attachment',
  'export_package',
  'platform_logo',
])
export const auditOutcome = pgEnum('audit_outcome', ['succeeded', 'rejected', 'failed'])
export const operationalCommandKind = pgEnum('operational_command_kind', [
  'dead_letter_replay',
  'instance_reconcile',
  'session_invalidate',
  'result_recalculate',
])
export const operationalCommandStatus = pgEnum('operational_command_status', [
  'pending',
  'succeeded',
  'failed',
])
export const securityLogSeverity = pgEnum('security_log_severity', ['info', 'warn', 'error'])

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  username: varchar({ length: 64 }).notNull(),
  usernameNormalized: varchar('username_normalized', { length: 64 }).notNull(),
  email: varchar({ length: 320 }).notNull(),
  emailNormalized: varchar('email_normalized', { length: 320 }).notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true, mode: 'date' }),
  status: userStatus().notNull().default('active'),
  sessionVersion: bigint('session_version', { mode: 'number' }).notNull().default(1),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  version: bigint({ mode: 'number' }).notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('users_username_normalized_unique').on(table.usernameNormalized),
  uniqueIndex('users_email_normalized_unique').on(table.emailNormalized),
  check('users_username_normalized_check', sql`${table.usernameNormalized} = lower(${table.usernameNormalized})`),
  check('users_email_normalized_check', sql`${table.emailNormalized} = lower(${table.emailNormalized})`),
  check('users_session_version_positive', sql`${table.sessionVersion} > 0`),
  check('users_version_positive', sql`${table.version} > 0`),
])

export const credentials = pgTable('credentials', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  algorithm: text().notNull().default('scrypt'),
  passwordHash: text('password_hash').notNull(),
  passwordUpdatedAt: timestamp('password_updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  check('credentials_algorithm_scrypt', sql`${table.algorithm} = 'scrypt'`),
  check('credentials_password_hash_not_empty', sql`length(${table.passwordHash}) > 0`),
])

export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  role: globalRole().notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

export const emailTokens = pgTable('email_tokens', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  purpose: emailTokenPurpose().notNull(),
  tokenDigest: bytea('token_digest').notNull(),
  targetEmailNormalized: varchar('target_email_normalized', { length: 320 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('email_tokens_digest_unique').on(table.tokenDigest),
  index('email_tokens_active_lookup').on(table.userId, table.purpose, table.expiresAt),
  check('email_tokens_target_normalized_check', sql`${table.targetEmailNormalized} = lower(${table.targetEmailNormalized})`),
  check('email_tokens_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
])

export const domainOutbox = pgTable('domain_outbox', {
  id: uuid().primaryKey().defaultRandom(),
  aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  eventType: varchar('event_type', { length: 128 }).notNull(),
  eventVersion: integer('event_version').notNull().default(1),
  dedupeKey: varchar('dedupe_key', { length: 200 }).notNull(),
  payload: jsonb().notNull().default({}),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastError: text('last_error'),
}, (table) => [
  uniqueIndex('domain_outbox_dedupe_key_unique').on(table.dedupeKey),
  index('domain_outbox_dispatch').on(table.publishedAt, table.availableAt, table.occurredAt),
  check('domain_outbox_aggregate_type_not_empty', sql`length(${table.aggregateType}) > 0`),
  check('domain_outbox_event_type_not_empty', sql`length(${table.eventType}) > 0`),
  check('domain_outbox_event_version_positive', sql`${table.eventVersion} > 0`),
  check('domain_outbox_attempt_count_nonnegative', sql`${table.attemptCount} >= 0`),
])

export const notifications = pgTable('notifications', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceEventId: uuid('source_event_id').notNull().references(() => domainOutbox.id),
  templateKey: varchar('template_key', { length: 128 }).notNull(),
  payload: jsonb().notNull().default({}),
  readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('notifications_user_source_unique').on(table.userId, table.sourceEventId),
  index('notifications_user_unread').on(table.userId, table.readAt, table.createdAt),
  check('notifications_template_key_not_empty', sql`length(${table.templateKey}) > 0`),
])

export const mailDeliveries = pgTable('mail_deliveries', {
  id: uuid().primaryKey().defaultRandom(),
  sourceEventId: uuid('source_event_id').notNull().references(() => domainOutbox.id),
  recipient: varchar({ length: 320 }).notNull(),
  recipientNormalized: varchar('recipient_normalized', { length: 320 }).notNull(),
  templateKey: varchar('template_key', { length: 128 }).notNull(),
  locale: systemLocale().notNull().default('zh-CN'),
  payload: jsonb().notNull().default({}),
  status: mailDeliveryStatus().notNull().default('pending'),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(8),
  availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  leaseOwner: varchar('lease_owner', { length: 128 }),
  leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'date' }),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('mail_deliveries_source_recipient_template_unique')
    .on(table.sourceEventId, table.recipientNormalized, table.templateKey),
  index('mail_deliveries_dispatch').on(table.status, table.availableAt),
  check('mail_deliveries_recipient_normalized_check', sql`${table.recipientNormalized} = lower(${table.recipientNormalized})`),
  check('mail_deliveries_template_key_not_empty', sql`length(${table.templateKey}) > 0`),
  check('mail_deliveries_attempt_count_nonnegative', sql`${table.attemptCount} >= 0`),
  check('mail_deliveries_max_attempts_positive', sql`${table.maxAttempts} > 0`),
  check('mail_deliveries_attempt_limit', sql`${table.attemptCount} <= ${table.maxAttempts}`),
])

export const teams = pgTable('teams', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 80 }).notNull(),
  nameNormalized: varchar('name_normalized', { length: 80 }).notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  version: bigint({ mode: 'number' }).notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('teams_name_normalized_unique').on(table.nameNormalized),
  check('teams_name_normalized_check', sql`${table.nameNormalized} = lower(${table.nameNormalized})`),
  check('teams_version_positive', sql`${table.version} > 0`),
])

export const teamMembers = pgTable('team_members', {
  id: uuid().primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: teamMemberRole().notNull().default('member'),
  joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('team_members_user_unique').on(table.userId),
  uniqueIndex('team_members_team_user_unique').on(table.teamId, table.userId),
  uniqueIndex('team_members_single_captain_unique').on(table.teamId).where(sql`${table.role} = 'captain'`),
  index('team_members_team_lookup').on(table.teamId, table.joinedAt),
])

export const teamInvites = pgTable('team_invites', {
  id: uuid().primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  tokenDigest: bytea('token_digest').notNull(),
  generation: integer().notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('team_invites_digest_unique').on(table.tokenDigest),
  uniqueIndex('team_invites_generation_unique').on(table.teamId, table.generation),
  uniqueIndex('team_invites_single_current_unique').on(table.teamId).where(sql`${table.revokedAt} IS NULL`),
  check('team_invites_generation_positive', sql`${table.generation} > 0`),
  check('team_invites_expiry_check', sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.createdAt}`),
  check('team_invites_revocation_check', sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`),
])

export const contests = pgTable('contests', {
  id: uuid().primaryKey().defaultRandom(),
  title: varchar({ length: 160 }).notNull(),
  slug: varchar({ length: 100 }).notNull(),
  description: text().notNull().default(''),
  publicationStatus: contestPublicationStatus('publication_status').notNull().default('draft'),
  visibility: contestVisibility().notNull().default('public'),
  registrationStrategy: registrationStrategy('registration_strategy').notNull().default('review'),
  inviteRequired: boolean('invite_required').notNull().default(false),
  inviteDigest: bytea('invite_digest'),
  startAt: timestamp('start_at', { withTimezone: true, mode: 'date' }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true, mode: 'date' }).notNull(),
  scoreboardFreezeAt: timestamp('scoreboard_freeze_at', { withTimezone: true, mode: 'date' }),
  practiceEnabled: boolean('practice_enabled').notNull().default(false),
  writeupRequired: boolean('writeup_required').notNull().default(false),
  writeupDeadlineAt: timestamp('writeup_deadline_at', { withTimezone: true, mode: 'date' }),
  minTeamSize: integer('min_team_size').notNull().default(1),
  maxTeamSize: integer('max_team_size').notNull().default(5),
  registrationConstraints: jsonb('registration_constraints').notNull().default({}),
  publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  version: bigint({ mode: 'number' }).notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('contests_slug_unique').on(table.slug),
  check('contests_slug_normalized', sql`${table.slug} = lower(${table.slug})`),
  check('contests_time_window', sql`${table.endAt} > ${table.startAt}`),
  check('contests_freeze_window', sql`${table.scoreboardFreezeAt} IS NULL OR (${table.scoreboardFreezeAt} >= ${table.startAt} AND ${table.scoreboardFreezeAt} <= ${table.endAt})`),
  check('contests_writeup_deadline', sql`${table.writeupDeadlineAt} IS NULL OR ${table.writeupDeadlineAt} >= ${table.endAt}`),
  check('contests_writeup_configuration', sql`${table.writeupRequired} OR ${table.writeupDeadlineAt} IS NULL`),
  check('contests_invite_configuration', sql`(NOT ${table.inviteRequired} OR ${table.inviteDigest} IS NOT NULL) AND (${table.inviteDigest} IS NULL OR octet_length(${table.inviteDigest}) = 32)`),
  check('contests_team_size', sql`${table.minTeamSize} > 0 AND ${table.maxTeamSize} >= ${table.minTeamSize} AND ${table.maxTeamSize} <= 100`),
  check('contests_registration_constraints_shape', sql`jsonb_typeof(${table.registrationConstraints}) = 'object' AND (${table.registrationConstraints} - 'allowed_email_domains') = '{}'::jsonb AND (NOT (${table.registrationConstraints} ? 'allowed_email_domains') OR jsonb_typeof(${table.registrationConstraints} -> 'allowed_email_domains') = 'array')`),
  check('contests_publication_timestamps', sql`(${table.publicationStatus} = 'draft' AND ${table.publishedAt} IS NULL AND ${table.archivedAt} IS NULL) OR (${table.publicationStatus} = 'published' AND ${table.publishedAt} IS NOT NULL AND ${table.archivedAt} IS NULL) OR (${table.publicationStatus} = 'archived' AND ${table.publishedAt} IS NOT NULL AND ${table.archivedAt} IS NOT NULL)`),
  check('contests_version_positive', sql`${table.version} > 0`),
])

export const divisions = pgTable('divisions', {
  id: uuid().primaryKey().defaultRandom(),
  contestId: uuid('contest_id').notNull().references(() => contests.id, { onDelete: 'cascade' }),
  name: varchar({ length: 80 }).notNull(),
  nameNormalized: varchar('name_normalized', { length: 80 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('divisions_contest_name_unique').on(table.contestId, table.nameNormalized),
  uniqueIndex('divisions_contest_id_id_unique').on(table.contestId, table.id),
  check('divisions_name_normalized_check', sql`${table.nameNormalized} = lower(${table.nameNormalized})`),
])

export const participations = pgTable('participations', {
  id: uuid().primaryKey().defaultRandom(),
  contestId: uuid('contest_id').notNull().references(() => contests.id, { onDelete: 'cascade' }),
  teamId: uuid('team_id').notNull().references(() => teams.id),
  divisionId: uuid('division_id'),
  status: participationStatus().notNull(),
  registeredBy: uuid('registered_by').notNull().references(() => users.id),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewReason: text('review_reason'),
  inviteDigestVerified: bytea('invite_digest_verified'),
  registeredAt: timestamp('registered_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true, mode: 'date' }),
  version: bigint({ mode: 'number' }).notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('participations_contest_team_unique').on(table.contestId, table.teamId),
  uniqueIndex('participations_contest_id_id_unique').on(table.contestId, table.id),
  index('participations_contest_status').on(table.contestId, table.status, table.registeredAt),
  index('participations_team_status').on(table.teamId, table.status),
  foreignKey({
    name: 'participations_contest_division_fk',
    columns: [table.contestId, table.divisionId],
    foreignColumns: [divisions.contestId, divisions.id],
  }),
  check('participations_review_state', sql`(${table.status} IN ('accepted', 'rejected') AND ${table.reviewedAt} IS NOT NULL AND ${table.reviewedBy} IS NOT NULL) OR (${table.status} IN ('pending', 'withdrawn'))`),
  check('participations_withdrawn_state', sql`(${table.status} = 'withdrawn' AND ${table.withdrawnAt} IS NOT NULL) OR (${table.status} <> 'withdrawn' AND ${table.withdrawnAt} IS NULL)`),
  check('participations_invite_digest_length', sql`${table.inviteDigestVerified} IS NULL OR octet_length(${table.inviteDigestVerified}) = 32`),
  check('participations_version_positive', sql`${table.version} > 0`),
])

export const announcements = pgTable('announcements', {
  id: uuid().primaryKey().defaultRandom(),
  contestId: uuid('contest_id').notNull().references(() => contests.id, { onDelete: 'cascade' }),
  title: varchar({ length: 200 }).notNull(),
  body: text().notNull(),
  publishAt: timestamp('publish_at', { withTimezone: true, mode: 'date' }).notNull(),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true, mode: 'date' }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  version: bigint({ mode: 'number' }).notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  index('announcements_publication_lookup').on(table.contestId, table.publishAt, table.withdrawnAt),
  check('announcements_title_not_empty', sql`length(${table.title}) > 0`),
  check('announcements_body_not_empty', sql`length(${table.body}) > 0`),
  check('announcements_version_positive', sql`${table.version} > 0`),
])

export const contestEvents = pgTable('contest_events', {
  id: uuid().primaryKey().defaultRandom(),
  contestId: uuid('contest_id').notNull().references(() => contests.id, { onDelete: 'cascade' }),
  eventType: contestEventType('event_type').notNull(),
  eventKey: varchar('event_key', { length: 200 }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  visibleAt: timestamp('visible_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  payload: jsonb().notNull().default({}),
}, (table) => [
  uniqueIndex('contest_events_contest_key_unique').on(table.contestId, table.eventKey),
  index('contest_events_public_timeline').on(table.contestId, table.visibleAt, table.occurredAt, table.id),
  check('contest_events_key_not_empty', sql`length(${table.eventKey}) > 0`),
])

export const contentObjects = pgTable('content_objects', {
  id: uuid().primaryKey().defaultRandom(),
  storageKey: varchar('storage_key', { length: 512 }).notNull(),
  sha256Digest: bytea('sha256_digest').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  mediaType: varchar('media_type', { length: 255 }).notNull(),
  originalFilename: varchar('original_filename', { length: 255 }).notNull(),
  status: contentObjectStatus().notNull().default('temporary'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  committedAt: timestamp('committed_at', { withTimezone: true, mode: 'date' }),
  deletionClaimedAt: timestamp('deletion_claimed_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('content_objects_storage_key_unique').on(table.storageKey),
  uniqueIndex('content_objects_digest_size_unique').on(table.sha256Digest, table.sizeBytes).where(sql`${table.status} <> 'deleted'`),
  index('content_objects_garbage_collection').on(table.status, table.createdAt, table.id).where(sql`${table.status} IN ('temporary', 'committed', 'quarantined')`),
  check('content_objects_storage_key_not_empty', sql`length(btrim(${table.storageKey})) > 0`),
  check('content_objects_sha256_length', sql`octet_length(${table.sha256Digest}) = 32`),
  check('content_objects_size_nonnegative', sql`${table.sizeBytes} >= 0`),
  check('content_objects_media_type_not_empty', sql`length(btrim(${table.mediaType})) > 0`),
  check('content_objects_filename_not_empty', sql`length(btrim(${table.originalFilename})) > 0`),
  check('content_objects_commit_state', sql`(${table.status} = 'temporary' AND ${table.committedAt} IS NULL) OR (${table.status} = 'committed' AND ${table.committedAt} IS NOT NULL) OR ${table.status} IN ('quarantined', 'deleted')`),
  check('content_objects_deletion_claim_state', sql`${table.deletionClaimedAt} IS NULL OR ${table.status} = 'quarantined'`),
])

export const challengeTemplates = pgTable('challenge_templates', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 160 }).notNull(),
  slug: varchar({ length: 100 }).notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  latestVersion: integer('latest_version').notNull().default(0),
  version: bigint({ mode: 'number' }).notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('challenge_templates_slug_unique').on(table.slug),
  check('challenge_templates_slug_normalized', sql`${table.slug} = lower(${table.slug})`),
  check('challenge_templates_latest_version_nonnegative', sql`${table.latestVersion} >= 0`),
  check('challenge_templates_version_positive', sql`${table.version} > 0`),
])

export const challengeTemplateVersions = pgTable('challenge_template_versions', {
  id: uuid().primaryKey().defaultRandom(),
  templateId: uuid('template_id').notNull().references(() => challengeTemplates.id),
  versionNumber: integer('version_number').notNull(),
  title: varchar({ length: 160 }).notNull(),
  category: challengeCategory().notNull(),
  description: text().notNull(),
  flagFormat: varchar('flag_format', { length: 160 }),
  flagPolicy: jsonb('flag_policy').notNull(),
  scoringPolicy: jsonb('scoring_policy').notNull(),
  instancePolicy: jsonb('instance_policy').notNull().default({ type: 'none' }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('challenge_template_versions_number_unique').on(table.templateId, table.versionNumber),
  uniqueIndex('challenge_template_versions_template_id_id_unique').on(table.templateId, table.id),
  check('challenge_template_versions_number_positive', sql`${table.versionNumber} > 0`),
  check('challenge_template_versions_title_not_empty', sql`length(${table.title}) > 0`),
  check('challenge_template_versions_description_not_empty', sql`length(${table.description}) > 0`),
  check('challenge_template_versions_flag_policy_object', sql`jsonb_typeof(${table.flagPolicy}) = 'object'`),
  check('challenge_template_versions_scoring_policy_object', sql`jsonb_typeof(${table.scoringPolicy}) = 'object'`),
  check('challenge_template_versions_instance_policy_object', sql`jsonb_typeof(${table.instancePolicy}) = 'object'`),
  check('challenge_template_versions_flag_policy_type', sql`(${table.flagPolicy} ? 'type') AND ${table.flagPolicy} ->> 'type' IN ('static', 'team-derived', 'synchronous')`),
  check('challenge_template_versions_scoring_policy_type', sql`(${table.scoringPolicy} ? 'type') AND ${table.scoringPolicy} ->> 'type' IN ('fixed-v1', 'decay-v1')`),
  check('challenge_template_versions_instance_policy_type', sql`(${table.instancePolicy} ? 'type') AND ${table.instancePolicy} ->> 'type' IN ('none', 'dynamic')`),
])

export const challengeTemplateAssets = pgTable('challenge_template_assets', {
  id: uuid().primaryKey().defaultRandom(),
  templateVersionId: uuid('template_version_id').notNull().references(() => challengeTemplateVersions.id),
  contentObjectId: uuid('content_object_id').notNull().references(() => contentObjects.id),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('challenge_template_assets_version_object_unique').on(table.templateVersionId, table.contentObjectId),
  index('challenge_template_assets_version_order').on(table.templateVersionId, table.sortOrder, table.id),
  check('challenge_template_assets_display_name_not_empty', sql`length(btrim(${table.displayName})) > 0`),
])

export const challengeTemplateHints = pgTable('challenge_template_hints', {
  id: uuid().primaryKey().defaultRandom(),
  templateVersionId: uuid('template_version_id').notNull().references(() => challengeTemplateVersions.id),
  title: varchar({ length: 160 }).notNull(),
  content: text().notNull(),
  releaseAfterSeconds: integer('release_after_seconds'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  index('challenge_template_hints_version_order').on(table.templateVersionId, table.sortOrder, table.id),
  check('challenge_template_hints_title_not_empty', sql`length(btrim(${table.title})) > 0`),
  check('challenge_template_hints_content_not_empty', sql`length(btrim(${table.content})) > 0`),
  check('challenge_template_hints_release_nonnegative', sql`${table.releaseAfterSeconds} IS NULL OR ${table.releaseAfterSeconds} >= 0`),
])

export const contestChallenges = pgTable('contest_challenges', {
  id: uuid().primaryKey().defaultRandom(),
  contestId: uuid('contest_id').notNull().references(() => contests.id, { onDelete: 'cascade' }),
  sourceTemplateId: uuid('source_template_id').notNull().references(() => challengeTemplates.id),
  sourceVersionId: uuid('source_version_id').notNull(),
  snapshotRevision: integer('snapshot_revision').notNull().default(1),
  title: varchar({ length: 160 }).notNull(),
  category: challengeCategory().notNull(),
  description: text().notNull(),
  flagFormat: varchar('flag_format', { length: 160 }),
  flagPolicy: jsonb('flag_policy').notNull(),
  scoringPolicy: jsonb('scoring_policy').notNull(),
  instancePolicy: jsonb('instance_policy').notNull().default({ type: 'none' }),
  enabled: boolean().notNull().default(false),
  publishAt: timestamp('publish_at', { withTimezone: true, mode: 'date' }),
  closeAt: timestamp('close_at', { withTimezone: true, mode: 'date' }),
  submissionLimit: integer('submission_limit'),
  sortOrder: integer('sort_order').notNull().default(0),
  version: bigint({ mode: 'number' }).notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('contest_challenges_contest_title_unique').on(table.contestId, table.title),
  foreignKey({
    name: 'contest_challenges_source_version_fk',
    columns: [table.sourceTemplateId, table.sourceVersionId],
    foreignColumns: [challengeTemplateVersions.templateId, challengeTemplateVersions.id],
  }),
  index('contest_challenges_publication_lookup').on(table.contestId, table.enabled, table.publishAt, table.sortOrder),
  check('contest_challenges_snapshot_revision_positive', sql`${table.snapshotRevision} > 0`),
  check('contest_challenges_publish_window', sql`${table.closeAt} IS NULL OR ${table.publishAt} IS NULL OR ${table.closeAt} > ${table.publishAt}`),
  check('contest_challenges_submission_limit_positive', sql`${table.submissionLimit} IS NULL OR ${table.submissionLimit} > 0`),
  check('contest_challenges_policy_objects', sql`jsonb_typeof(${table.flagPolicy}) = 'object' AND jsonb_typeof(${table.scoringPolicy}) = 'object' AND jsonb_typeof(${table.instancePolicy}) = 'object'`),
  check('contest_challenges_flag_policy_type', sql`(${table.flagPolicy} ? 'type') AND ${table.flagPolicy} ->> 'type' IN ('static', 'team-derived', 'synchronous')`),
  check('contest_challenges_scoring_policy_type', sql`(${table.scoringPolicy} ? 'type') AND ${table.scoringPolicy} ->> 'type' IN ('fixed-v1', 'decay-v1')`),
  check('contest_challenges_instance_policy_type', sql`(${table.instancePolicy} ? 'type') AND ${table.instancePolicy} ->> 'type' IN ('none', 'dynamic')`),
  check('contest_challenges_version_positive', sql`${table.version} > 0`),
])

export const challengeHints = pgTable('challenge_hints', {
  id: uuid().primaryKey().defaultRandom(),
  contestChallengeId: uuid('contest_challenge_id').notNull().references(() => contestChallenges.id, { onDelete: 'cascade' }),
  title: varchar({ length: 160 }).notNull(),
  content: text().notNull(),
  releaseAt: timestamp('release_at', { withTimezone: true, mode: 'date' }),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  index('challenge_hints_release_lookup').on(table.contestChallengeId, table.releaseAt, table.sortOrder),
  check('challenge_hints_content_not_empty', sql`length(${table.content}) > 0`),
])

export const challengeAssets = pgTable('challenge_assets', {
  id: uuid().primaryKey().defaultRandom(),
  contestChallengeId: uuid('contest_challenge_id').notNull().references(() => contestChallenges.id, { onDelete: 'cascade' }),
  contentObjectId: uuid('content_object_id').notNull().references(() => contentObjects.id),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('challenge_assets_challenge_object_unique').on(table.contestChallengeId, table.contentObjectId),
  check('challenge_assets_display_name_not_empty', sql`length(${table.displayName}) > 0`),
])

export const submissions = pgTable('submissions', {
  id: uuid().primaryKey().defaultRandom(),
  contestId: uuid('contest_id').notNull().references(() => contests.id),
  contestChallengeId: uuid('contest_challenge_id').notNull().references(() => contestChallenges.id),
  participationId: uuid('participation_id').notNull().references(() => participations.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  mode: submissionMode().notNull(),
  result: submissionResult().notNull(),
  answerDigest: bytea('answer_digest').notNull(),
  answerCiphertext: bytea('answer_ciphertext').notNull(),
  requestId: varchar('request_id', { length: 128 }).notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('submissions_request_id_unique').on(table.requestId),
  index('submissions_contest_challenge_time').on(table.contestId, table.contestChallengeId, table.submittedAt, table.id),
  index('submissions_participation_time').on(table.participationId, table.submittedAt, table.id),
  check('submissions_answer_digest_length', sql`octet_length(${table.answerDigest}) = 32`),
  check('submissions_answer_ciphertext_envelope', sql`octet_length(${table.answerCiphertext}) >= 33`),
])

export const solves = pgTable('solves', {
  id: uuid().primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => submissions.id),
  contestId: uuid('contest_id').notNull().references(() => contests.id),
  contestChallengeId: uuid('contest_challenge_id').notNull().references(() => contestChallenges.id),
  participationId: uuid('participation_id').notNull().references(() => participations.id),
  mode: submissionMode().notNull(),
  awardedScore: integer('awarded_score').notNull(),
  solveOrder: integer('solve_order').notNull(),
  solvedAt: timestamp('solved_at', { withTimezone: true, mode: 'date' }).notNull(),
}, (table) => [
  uniqueIndex('solves_submission_unique').on(table.submissionId),
  uniqueIndex('solves_participation_challenge_mode_unique')
    .on(table.participationId, table.contestChallengeId, table.mode),
  uniqueIndex('solves_challenge_mode_order_unique').on(table.contestChallengeId, table.mode, table.solveOrder),
  index('solves_contest_mode_time').on(table.contestId, table.mode, table.solvedAt, table.id),
  check('solves_awarded_score_nonnegative', sql`${table.awardedScore} >= 0`),
  check('solves_order_positive', sql`${table.solveOrder} > 0`),
])

export const scoreAdjustments = pgTable('score_adjustments', {
  id: uuid().primaryKey().defaultRandom(),
  contestId: uuid('contest_id').notNull().references(() => contests.id),
  participationId: uuid('participation_id').notNull().references(() => participations.id),
  pointsDelta: integer('points_delta').notNull(),
  reason: text().notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  requestId: varchar('request_id', { length: 128 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('score_adjustments_request_id_unique').on(table.requestId),
  index('score_adjustments_contest_participation').on(table.contestId, table.participationId, table.createdAt),
  check('score_adjustments_delta_nonzero', sql`${table.pointsDelta} <> 0`),
  check('score_adjustments_reason_not_empty', sql`length(${table.reason}) > 0`),
])

export const cheatClues = pgTable('cheat_clues', {
  id: uuid().primaryKey().defaultRandom(),
  clueKey: varchar('clue_key', { length: 200 }).notNull(),
  contestId: uuid('contest_id').notNull().references(() => contests.id),
  contestChallengeId: uuid('contest_challenge_id').references(() => contestChallenges.id),
  participationId: uuid('participation_id').references(() => participations.id),
  clueType: varchar('clue_type', { length: 100 }).notNull(),
  evidence: jsonb().notNull(),
  status: cheatClueStatus().notNull().default('open'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewNote: text('review_note'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('cheat_clues_key_unique').on(table.clueKey),
  index('cheat_clues_review_queue').on(table.contestId, table.status, table.createdAt),
  check('cheat_clues_type_not_empty', sql`length(${table.clueType}) > 0`),
  check('cheat_clues_type_supported', sql`${table.clueType} IN ('repeated_incorrect_answer', 'shared_incorrect_answer', 'abnormal_submission_frequency', 'foreign_team_flag')`),
  check('cheat_clues_evidence_object', sql`jsonb_typeof(${table.evidence}) = 'object'`),
  check('cheat_clues_review_state', sql`(${table.status} IN ('dismissed', 'confirmed') AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL) OR ${table.status} IN ('open', 'reviewing')`),
])

export const scoreboardVersions = pgTable('scoreboard_versions', {
  contestId: uuid('contest_id').primaryKey().references(() => contests.id, { onDelete: 'cascade' }),
  version: bigint({ mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  check('scoreboard_versions_nonnegative', sql`${table.version} >= 0`),
])

export const scoreboardSnapshots = pgTable('scoreboard_snapshots', {
  id: uuid().primaryKey().defaultRandom(),
  contestId: uuid('contest_id').notNull().references(() => contests.id, { onDelete: 'cascade' }),
  view: scoreboardView().notNull(),
  divisionId: uuid('division_id'),
  scopeKey: varchar('scope_key', { length: 64 }).notNull(),
  version: bigint({ mode: 'number' }).notNull(),
  payload: jsonb().notNull(),
  builtAt: timestamp('built_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('scoreboard_snapshots_scope_version_unique').on(table.contestId, table.view, table.scopeKey, table.version),
  foreignKey({
    name: 'scoreboard_snapshots_contest_division_fk',
    columns: [table.contestId, table.divisionId],
    foreignColumns: [divisions.contestId, divisions.id],
  }),
  index('scoreboard_snapshots_latest').on(table.contestId, table.view, table.scopeKey, table.version),
  check('scoreboard_snapshots_scope_key', sql`(${table.divisionId} IS NULL AND ${table.scopeKey} = 'overall') OR (${table.divisionId} IS NOT NULL AND ${table.scopeKey} = ${table.divisionId}::text)`),
  check('scoreboard_snapshots_version_nonnegative', sql`${table.version} >= 0`),
  check('scoreboard_snapshots_payload_object', sql`jsonb_typeof(${table.payload}) = 'object'`),
])

export const instances = pgTable('instances', {
  id: uuid().primaryKey().defaultRandom(),
  contestId: uuid('contest_id').notNull().references(() => contests.id),
  contestChallengeId: uuid('contest_challenge_id').notNull().references(() => contestChallenges.id),
  participationId: uuid('participation_id').notNull().references(() => participations.id),
  provider: instanceProvider().notNull(),
  desiredState: instanceDesiredState('desired_state').notNull().default('stopped'),
  desiredGeneration: bigint('desired_generation', { mode: 'number' }).notNull().default(1),
  observedState: instanceObservedState('observed_state').notNull().default('pending'),
  observedGeneration: bigint('observed_generation', { mode: 'number' }).notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  providerResourceId: varchar('provider_resource_id', { length: 255 }),
  entrypoints: jsonb().notNull().default([]),
  accessCiphertext: bytea('access_ciphertext'),
  lastObservedAt: timestamp('last_observed_at', { withTimezone: true, mode: 'date' }),
  lastErrorCode: varchar('last_error_code', { length: 128 }),
  lastErrorSummary: text('last_error_summary'),
  version: bigint({ mode: 'number' }).notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('instances_participation_challenge_unique').on(table.participationId, table.contestChallengeId),
  index('instances_expiry_reconcile').on(table.desiredState, table.expiresAt),
  index('instances_observation_staleness').on(table.observedState, table.lastObservedAt),
  check('instances_desired_generation_positive', sql`${table.desiredGeneration} > 0`),
  check('instances_observed_generation_nonnegative', sql`${table.observedGeneration} >= 0`),
  check('instances_observation_not_ahead', sql`${table.observedGeneration} <= ${table.desiredGeneration}`),
  check('instances_entrypoints_array', sql`jsonb_typeof(${table.entrypoints}) = 'array'`),
  check('instances_version_positive', sql`${table.version} > 0`),
])

export const instanceJobs = pgTable('instance_jobs', {
  id: uuid().primaryKey().defaultRandom(),
  instanceId: uuid('instance_id').notNull().references(() => instances.id, { onDelete: 'cascade' }),
  operation: instanceJobOperation().notNull(),
  payloadVersion: integer('payload_version').notNull(),
  payload: jsonb().notNull(),
  desiredGeneration: bigint('desired_generation', { mode: 'number' }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
  status: instanceJobStatus().notNull().default('ready'),
  availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  leaseOwner: varchar('lease_owner', { length: 128 }),
  leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'date' }),
  fencingToken: bigint('fencing_token', { mode: 'number' }).notNull().default(0),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(8),
  errorCode: varchar('error_code', { length: 128 }),
  errorSummary: text('error_summary'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  uniqueIndex('instance_jobs_idempotency_key_unique').on(table.idempotencyKey),
  uniqueIndex('instance_jobs_generation_operation_unique').on(table.instanceId, table.desiredGeneration, table.operation),
  index('instance_jobs_claim').on(table.status, table.availableAt, table.createdAt),
  index('instance_jobs_lease_expiry').on(table.status, table.leaseUntil),
  check('instance_jobs_payload_version_positive', sql`${table.payloadVersion} > 0`),
  check('instance_jobs_payload_object', sql`jsonb_typeof(${table.payload}) = 'object'`),
  check('instance_jobs_desired_generation_positive', sql`${table.desiredGeneration} > 0`),
  check('instance_jobs_fencing_nonnegative', sql`${table.fencingToken} >= 0`),
  check('instance_jobs_attempts_valid', sql`${table.attemptCount} >= 0 AND ${table.maxAttempts} > 0 AND ${table.attemptCount} <= ${table.maxAttempts}`),
  check('instance_jobs_lease_shape', sql`(${table.status} = 'leased' AND ${table.leaseOwner} IS NOT NULL AND ${table.leaseUntil} IS NOT NULL) OR (${table.status} <> 'leased')`),
])

export const instanceJobAttempts = pgTable('instance_job_attempts', {
  id: uuid().primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => instanceJobs.id, { onDelete: 'cascade' }),
  attemptNumber: integer('attempt_number').notNull(),
  workerId: varchar('worker_id', { length: 128 }).notNull(),
  fencingToken: bigint('fencing_token', { mode: 'number' }).notNull(),
  outcome: instanceAttemptOutcome().notNull().default('running'),
  errorCode: varchar('error_code', { length: 128 }),
  errorSummary: text('error_summary'),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  uniqueIndex('instance_job_attempts_number_unique').on(table.jobId, table.attemptNumber),
  index('instance_job_attempts_job_time').on(table.jobId, table.startedAt),
  check('instance_job_attempts_number_positive', sql`${table.attemptNumber} > 0`),
  check('instance_job_attempts_fencing_positive', sql`${table.fencingToken} > 0`),
  check('instance_job_attempts_finish_state', sql`(${table.outcome} = 'running' AND ${table.finishedAt} IS NULL) OR (${table.outcome} <> 'running' AND ${table.finishedAt} IS NOT NULL)`),
])

export const instanceOrphanReports = pgTable('instance_orphan_reports', {
  id: uuid().primaryKey().defaultRandom(),
  provider: instanceProvider().notNull(),
  providerResourceId: varchar('provider_resource_id', { length: 255 }).notNull(),
  claimedInstanceId: uuid('claimed_instance_id'),
  claimedGeneration: bigint('claimed_generation', { mode: 'number' }),
  reason: varchar({ length: 64 }).notNull(),
  ownershipLabels: jsonb('ownership_labels').notNull(),
  occurrences: integer().notNull().default(1),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  uniqueIndex('instance_orphan_reports_resource_unique').on(table.provider, table.providerResourceId),
  index('instance_orphan_reports_open').on(table.resolvedAt, table.lastSeenAt),
  check('instance_orphan_reports_resource_id_not_empty', sql`length(${table.providerResourceId}) > 0`),
  check('instance_orphan_reports_generation_positive', sql`${table.claimedGeneration} IS NULL OR ${table.claimedGeneration} > 0`),
  check('instance_orphan_reports_reason_supported', sql`${table.reason} IN ('unknown_instance', 'identity_mismatch', 'provider_mismatch', 'future_generation', 'duplicate_identity')`),
  check('instance_orphan_reports_labels_object', sql`jsonb_typeof(${table.ownershipLabels}) = 'object'`),
  check('instance_orphan_reports_occurrences_positive', sql`${table.occurrences} > 0`),
])

export const writeups = pgTable('writeups', {
  id: uuid().primaryKey().defaultRandom(),
  contestId: uuid('contest_id').notNull().references(() => contests.id),
  participationId: uuid('participation_id').notNull(),
  status: writeupStatus().notNull().default('draft'),
  currentVersion: integer('current_version'),
  submittedVersion: integer('submitted_version'),
  submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewNote: text('review_note'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
  version: bigint({ mode: 'number' }).notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('writeups_contest_participation_unique').on(table.contestId, table.participationId),
  foreignKey({
    name: 'writeups_contest_participation_fk',
    columns: [table.contestId, table.participationId],
    foreignColumns: [participations.contestId, participations.id],
  }),
  index('writeups_review_queue').on(table.contestId, table.status, table.submittedAt),
  check('writeups_current_version_positive', sql`${table.currentVersion} IS NULL OR ${table.currentVersion} > 0`),
  check('writeups_submitted_version_valid', sql`${table.submittedVersion} IS NULL OR (${table.submittedVersion} > 0 AND ${table.submittedVersion} <= ${table.currentVersion})`),
  check('writeups_submission_state', sql`(${table.status} = 'draft' AND ${table.submittedVersion} IS NULL AND ${table.submittedAt} IS NULL) OR (${table.status} <> 'draft' AND ${table.currentVersion} IS NOT NULL AND ${table.submittedVersion} IS NOT NULL AND ${table.submittedAt} IS NOT NULL)`),
  check('writeups_review_state', sql`(${table.status} IN ('draft', 'submitted') AND ${table.reviewedBy} IS NULL AND ${table.reviewNote} IS NULL AND ${table.reviewedAt} IS NULL) OR (${table.status} = 'approved' AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL) OR (${table.status} = 'changes_requested' AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL AND length(btrim(${table.reviewNote})) > 0)`),
  check('writeups_version_positive', sql`${table.version} > 0`),
])

export const writeupVersions = pgTable('writeup_versions', {
  id: uuid().primaryKey().defaultRandom(),
  writeupId: uuid('writeup_id').notNull().references(() => writeups.id),
  versionNumber: integer('version_number').notNull(),
  body: text().notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('writeup_versions_number_unique').on(table.writeupId, table.versionNumber),
  check('writeup_versions_number_positive', sql`${table.versionNumber} > 0`),
])

export const imports = pgTable('imports', {
  id: uuid().primaryKey().defaultRandom(),
  packageObjectId: uuid('package_object_id').notNull().references(() => contentObjects.id),
  packageVersion: varchar('package_version', { length: 64 }).notNull(),
  status: transferStatus().notNull().default('queued'),
  idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
  requestedBy: uuid('requested_by').notNull().references(() => users.id),
  resultContestId: uuid('result_contest_id').references(() => contests.id),
  errorDetails: jsonb('error_details'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  uniqueIndex('imports_idempotency_key_unique').on(table.idempotencyKey),
  index('imports_status_queue').on(table.status, table.createdAt),
  check('imports_package_version_not_empty', sql`length(btrim(${table.packageVersion})) > 0`),
  check('imports_idempotency_key_length', sql`length(${table.idempotencyKey}) BETWEEN 16 AND 128`),
  check('imports_error_details_object', sql`${table.errorDetails} IS NULL OR jsonb_typeof(${table.errorDetails}) = 'object'`),
  check('imports_result_state', sql`(${table.status} = 'succeeded' AND ${table.resultContestId} IS NOT NULL AND ${table.errorDetails} IS NULL AND ${table.finishedAt} IS NOT NULL) OR (${table.status} = 'failed' AND ${table.resultContestId} IS NULL AND ${table.errorDetails} IS NOT NULL AND ${table.finishedAt} IS NOT NULL) OR (${table.status} IN ('queued', 'validating', 'processing') AND ${table.resultContestId} IS NULL AND ${table.errorDetails} IS NULL AND ${table.finishedAt} IS NULL)`),
])

export const exports = pgTable('exports', {
  id: uuid().primaryKey().defaultRandom(),
  contestId: uuid('contest_id').notNull().references(() => contests.id),
  packageObjectId: uuid('package_object_id').references(() => contentObjects.id),
  packageVersion: varchar('package_version', { length: 64 }).notNull(),
  status: transferStatus().notNull().default('queued'),
  idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
  requestedBy: uuid('requested_by').notNull().references(() => users.id),
  errorDetails: jsonb('error_details'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  uniqueIndex('exports_idempotency_key_unique').on(table.idempotencyKey),
  index('exports_status_queue').on(table.status, table.createdAt),
  check('exports_package_version_not_empty', sql`length(btrim(${table.packageVersion})) > 0`),
  check('exports_idempotency_key_length', sql`length(${table.idempotencyKey}) BETWEEN 16 AND 128`),
  check('exports_error_details_object', sql`${table.errorDetails} IS NULL OR jsonb_typeof(${table.errorDetails}) = 'object'`),
  check('exports_result_state', sql`(${table.status} = 'succeeded' AND ${table.packageObjectId} IS NOT NULL AND ${table.errorDetails} IS NULL AND ${table.finishedAt} IS NOT NULL) OR (${table.status} = 'failed' AND ${table.packageObjectId} IS NULL AND ${table.errorDetails} IS NOT NULL AND ${table.finishedAt} IS NOT NULL) OR (${table.status} IN ('queued', 'validating', 'processing') AND ${table.packageObjectId} IS NULL AND ${table.errorDetails} IS NULL AND ${table.finishedAt} IS NULL)`),
])

export const platformSettings = pgTable('platform_settings', {
  singleton: boolean().primaryKey().default(true),
  brandName: varchar('brand_name', { length: 120 }).notNull().default('SauryCTF'),
  logoObjectId: uuid('logo_object_id').references(() => contentObjects.id),
  theme: platformTheme().notNull().default('dark'),
  defaultLocale: systemLocale('default_locale').notNull().default('zh-CN'),
  publicRegistrationEnabled: boolean('public_registration_enabled').notNull().default(true),
  authenticationMode: authenticationMode('authentication_mode').notNull().default('password_only'),
  version: bigint({ mode: 'number' }).notNull().default(1),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  check('platform_settings_singleton_true', sql`${table.singleton} = true`),
  check('platform_settings_brand_name_not_empty', sql`length(btrim(${table.brandName})) > 0`),
  check('platform_settings_version_positive', sql`${table.version} > 0`),
])

export const contentReferences = pgTable('content_references', {
  id: uuid().primaryKey().defaultRandom(),
  contentObjectId: uuid('content_object_id').notNull().references(() => contentObjects.id),
  referenceType: contentReferenceType('reference_type').notNull(),
  contestChallengeId: uuid('contest_challenge_id').references(() => contestChallenges.id, { onDelete: 'cascade' }),
  writeupVersionId: uuid('writeup_version_id').references(() => writeupVersions.id, { onDelete: 'cascade' }),
  exportId: uuid('export_id').references(() => exports.id, { onDelete: 'cascade' }),
  platformSettingId: boolean('platform_setting_id').references(() => platformSettings.singleton, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('content_references_challenge_object_unique').on(table.contestChallengeId, table.contentObjectId).where(sql`${table.contestChallengeId} IS NOT NULL`),
  uniqueIndex('content_references_writeup_object_unique').on(table.writeupVersionId, table.contentObjectId).where(sql`${table.writeupVersionId} IS NOT NULL`),
  uniqueIndex('content_references_export_object_unique').on(table.exportId, table.contentObjectId).where(sql`${table.exportId} IS NOT NULL`),
  uniqueIndex('content_references_setting_object_unique').on(table.platformSettingId, table.contentObjectId).where(sql`${table.platformSettingId} IS NOT NULL`),
  index('content_references_object_lookup').on(table.contentObjectId, table.referenceType),
  check('content_references_exactly_one_owner', sql`num_nonnulls(${table.contestChallengeId}, ${table.writeupVersionId}, ${table.exportId}, ${table.platformSettingId}) = 1`),
  check('content_references_owner_type', sql`(${table.referenceType} = 'challenge_attachment' AND ${table.contestChallengeId} IS NOT NULL) OR (${table.referenceType} = 'writeup_attachment' AND ${table.writeupVersionId} IS NOT NULL) OR (${table.referenceType} = 'export_package' AND ${table.exportId} IS NOT NULL) OR (${table.referenceType} = 'platform_logo' AND ${table.platformSettingId} IS NOT NULL)`),
])

export const auditEvents = pgTable('audit_events', {
  id: uuid().primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  action: varchar({ length: 128 }).notNull(),
  targetType: varchar('target_type', { length: 64 }).notNull(),
  targetId: uuid('target_id'),
  reason: text(),
  outcome: auditOutcome().notNull(),
  requestId: varchar('request_id', { length: 128 }).notNull(),
  changes: jsonb().notNull().default({}),
  metadata: jsonb().notNull().default({}),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('audit_events_request_action_target_unique')
    .on(table.requestId, table.action, table.targetType, table.targetId)
    .where(sql`${table.targetId} IS NOT NULL`),
  uniqueIndex('audit_events_request_action_without_target_unique')
    .on(table.requestId, table.action, table.targetType)
    .where(sql`${table.targetId} IS NULL`),
  index('audit_events_actor_time').on(table.actorUserId, table.occurredAt, table.id),
  index('audit_events_target_time').on(table.targetType, table.targetId, table.occurredAt, table.id),
  check('audit_events_action_not_empty', sql`length(btrim(${table.action})) > 0`),
  check('audit_events_target_type_not_empty', sql`length(btrim(${table.targetType})) > 0`),
  check('audit_events_request_id_not_empty', sql`length(btrim(${table.requestId})) > 0`),
  check('audit_events_reason_not_empty', sql`${table.reason} IS NULL OR length(btrim(${table.reason})) > 0`),
  check('audit_events_changes_object', sql`jsonb_typeof(${table.changes}) = 'object'`),
  check('audit_events_metadata_object', sql`jsonb_typeof(${table.metadata}) = 'object'`),
])

export const operationalCommands = pgTable('operational_commands', {
  id: uuid().primaryKey().defaultRandom(),
  kind: operationalCommandKind().notNull(),
  targetId: uuid('target_id').notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
  actorUserId: uuid('actor_user_id').notNull().references(() => users.id),
  requestId: varchar('request_id', { length: 128 }).notNull(),
  reason: text().notNull(),
  status: operationalCommandStatus().notNull().default('pending'),
  result: jsonb(),
  errorCode: varchar('error_code', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  uniqueIndex('operational_commands_idempotency_key_unique').on(table.idempotencyKey),
  index('operational_commands_status_time').on(table.status, table.createdAt),
  check('operational_commands_idempotency_key_length', sql`length(${table.idempotencyKey}) BETWEEN 16 AND 128`),
  check('operational_commands_request_id_not_empty', sql`length(btrim(${table.requestId})) > 0`),
  check('operational_commands_reason_length', sql`length(btrim(${table.reason})) BETWEEN 10 AND 1000`),
  check('operational_commands_result_object', sql`${table.result} IS NULL OR jsonb_typeof(${table.result}) = 'object'`),
  check('operational_commands_result_state', sql`(${table.status} = 'pending' AND ${table.result} IS NULL AND ${table.errorCode} IS NULL AND ${table.completedAt} IS NULL) OR (${table.status} = 'succeeded' AND ${table.result} IS NOT NULL AND ${table.errorCode} IS NULL AND ${table.completedAt} IS NOT NULL) OR (${table.status} = 'failed' AND ${table.result} IS NULL AND ${table.errorCode} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`),
])

export const securityLogEvents = pgTable('security_log_events', {
  id: uuid().primaryKey().defaultRandom(),
  eventType: varchar('event_type', { length: 128 }).notNull(),
  severity: securityLogSeverity().notNull(),
  requestId: varchar('request_id', { length: 128 }).notNull(),
  errorCode: varchar('error_code', { length: 128 }).notNull(),
  method: varchar({ length: 16 }).notNull(),
  route: text().notNull(),
  statusCode: integer('status_code').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  index('security_log_events_expiry').on(table.occurredAt, table.id),
  index('security_log_events_request').on(table.requestId, table.occurredAt),
  check('security_log_events_event_type_not_empty', sql`length(btrim(${table.eventType})) > 0`),
  check('security_log_events_request_id_not_empty', sql`length(btrim(${table.requestId})) > 0`),
  check('security_log_events_error_code_not_empty', sql`length(btrim(${table.errorCode})) > 0`),
  check('security_log_events_method_not_empty', sql`length(btrim(${table.method})) > 0`),
  check('security_log_events_route_absolute', sql`left(${table.route}, 1) = '/'`),
  check('security_log_events_status_code', sql`${table.statusCode} BETWEEN 400 AND 599`),
])

export const rateLimitWindows = pgTable('rate_limit_windows', {
  bucketDigest: bytea('bucket_digest').notNull(),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true, mode: 'date' }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  requestCount: integer('request_count').notNull().default(0),
}, (table) => [
  uniqueIndex('rate_limit_windows_bucket_window_unique')
    .on(table.bucketDigest, table.windowStartedAt),
  index('rate_limit_windows_expiry').on(table.expiresAt, table.windowStartedAt),
  check('rate_limit_windows_bucket_digest_sha256', sql`octet_length(${table.bucketDigest}) = 32`),
  check('rate_limit_windows_expiry_after_start', sql`${table.expiresAt} > ${table.windowStartedAt}`),
  check('rate_limit_windows_request_count_nonnegative', sql`${table.requestCount} >= 0`),
])
