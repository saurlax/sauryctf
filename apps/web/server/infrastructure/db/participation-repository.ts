import { timingSafeEqual } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import {
  ParticipationConfigurationInvalidError,
  ParticipationConflictError,
  ParticipationContestNotFoundError,
  ParticipationDivisionInvalidError,
  ParticipationEmailDomainForbiddenError,
  ParticipationInviteInvalidError,
  ParticipationMemberIneligibleError,
  ParticipationNotFoundError,
  ParticipationRegistrationClosedError,
  ParticipationTeamRequiredError,
  ParticipationTeamSizeError,
  ParticipationTransitionInvalidError,
  type CurrentParticipationRecord,
  type ParticipationDivisionCommand,
  type ParticipationPage,
  type ParticipationRecord,
  type ParticipationRepository,
  type ParticipationReviewCommand,
  type ParticipationStatus,
} from '../../domains/participations/repository'

interface LockedContest {
  id: string
  publicationStatus: 'draft' | 'published' | 'archived'
  registrationStrategy: 'review' | 'auto_accept'
  visibility: 'public' | 'private'
  inviteDigest: Buffer | null
  registrationOpen: boolean
  minTeamSize: number
  maxTeamSize: number
  registrationConstraints: unknown
}

interface ParticipationRow {
  id: string
  contest_id: string
  team_id: string
  team_name: string
  division_id: string | null
  division_name: string | null
  status: ParticipationStatus
  registered_at: Date
  reviewed_at: Date | null
  review_reason: string | null
  withdrawn_at: Date | null
  version: string
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: string }).code === '23505'
}

export class PostgresParticipationRepository implements ParticipationRepository {
  constructor(private pool: Pool) {}

  async current(userId: string, contestId: string): Promise<CurrentParticipationRecord> {
    const contest = await this.pool.query('SELECT 1 FROM contests WHERE id = $1', [contestId])
    if (!contest.rows[0]) throw new ParticipationContestNotFoundError()
    const team = await this.pool.query<{
      id: string
      name: string
      role: 'member' | 'captain'
    }>(
      `SELECT t.id, t.name, m.role::text
       FROM team_members m
       JOIN teams t ON t.id = m.team_id
       WHERE m.user_id = $1`,
      [userId],
    )
    if (!team.rows[0]) return { team: null, participation: null }
    return {
      team: team.rows[0],
      participation: await this.readByTeam(this.pool, contestId, team.rows[0].id),
    }
  }

  async register(userId: string, contestId: string, inviteDigest: Buffer | null): Promise<ParticipationRecord> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const team = await this.lockActorTeam(connection, userId)
      const contest = await this.lockContest(connection, contestId)
      this.requireRegistrationOpen(contest)
      const verifiedInviteDigest = this.verifySubmittedInvite(contest, inviteDigest)
      await this.validateTeamEligibility(connection, team.id, contest)

      const existing = await connection.query<{ id: string, status: ParticipationStatus }>(
        'SELECT id, status::text FROM participations WHERE contest_id = $1 AND team_id = $2 FOR UPDATE',
        [contestId, team.id],
      )
      if (existing.rows[0] && existing.rows[0].status !== 'withdrawn') {
        throw new ParticipationConflictError()
      }

      const divisionId = await this.defaultDivision(connection, contestId)
      const accepted = contest.registrationStrategy === 'auto_accept'
      const status: ParticipationStatus = accepted ? 'accepted' : 'pending'
      let participationId: string
      if (existing.rows[0]) {
        const result = await connection.query<{ id: string }>(
          `UPDATE participations
           SET status = $2,
               division_id = $3,
               registered_by = $4,
               registered_at = now(),
               reviewed_by = $5,
               reviewed_at = CASE WHEN $5::uuid IS NULL THEN NULL ELSE now() END,
               review_reason = $6,
               withdrawn_at = NULL,
               invite_digest_verified = $7,
               version = version + 1,
               updated_at = now()
           WHERE id = $1
           RETURNING id`,
          [
            existing.rows[0].id,
            status,
            divisionId,
            userId,
            accepted ? userId : null,
            accepted ? 'auto_accept' : null,
            verifiedInviteDigest,
          ],
        )
        participationId = result.rows[0]!.id
      }
      else {
        const result = await connection.query<{ id: string }>(
          `INSERT INTO participations
             (contest_id, team_id, division_id, status, registered_by,
              reviewed_by, reviewed_at, review_reason, invite_digest_verified)
           VALUES ($1, $2, $3, $4, $5, $6,
                   CASE WHEN $6::uuid IS NULL THEN NULL ELSE now() END, $7, $8)
           RETURNING id`,
          [
            contestId,
            team.id,
            divisionId,
            status,
            userId,
            accepted ? userId : null,
            accepted ? 'auto_accept' : null,
            verifiedInviteDigest,
          ],
        )
        participationId = result.rows[0]!.id
      }

      const participation = await this.readById(connection, contestId, participationId)
      await connection.query('COMMIT')
      return participation
    }
    catch (error) {
      await connection.query('ROLLBACK')
      if (isUniqueViolation(error)) throw new ParticipationConflictError()
      throw error
    }
    finally {
      connection.release()
    }
  }

  async withdraw(userId: string, contestId: string): Promise<ParticipationRecord> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const team = await this.lockActorTeam(connection, userId)
      await this.lockContest(connection, contestId)
      const participation = await connection.query<{ id: string, status: ParticipationStatus }>(
        'SELECT id, status::text FROM participations WHERE contest_id = $1 AND team_id = $2 FOR UPDATE',
        [contestId, team.id],
      )
      if (!participation.rows[0]) throw new ParticipationNotFoundError()
      if (!['pending', 'rejected'].includes(participation.rows[0].status)) {
        throw new ParticipationTransitionInvalidError()
      }
      await connection.query(
        `UPDATE participations
         SET status = 'withdrawn', withdrawn_at = now(), version = version + 1, updated_at = now()
         WHERE id = $1`,
        [participation.rows[0].id],
      )
      const result = await this.readById(connection, contestId, participation.rows[0].id)
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

  async review(command: ParticipationReviewCommand): Promise<ParticipationRecord> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const teamId = await this.locateParticipationTeam(connection, command.contestId, command.participationId)
      await this.lockTeam(connection, teamId)
      const contest = await this.lockContest(connection, command.contestId)
      const current = await connection.query<{
        status: ParticipationStatus
        invite_digest_verified: Buffer | null
      }>(
        `SELECT status::text, invite_digest_verified
         FROM participations
         WHERE id = $1 AND contest_id = $2 AND team_id = $3
         FOR UPDATE`,
        [command.participationId, command.contestId, teamId],
      )
      if (!current.rows[0]) throw new ParticipationNotFoundError()
      if (current.rows[0].status !== 'pending') throw new ParticipationTransitionInvalidError()

      if (command.decision === 'accepted') {
        this.requireRegistrationOpen(contest)
        this.verifyInviteEvidence(contest, current.rows[0].invite_digest_verified)
        await this.validateTeamEligibility(connection, teamId, contest)
      }

      await connection.query(
        `UPDATE participations
         SET status = $2,
             reviewed_by = $3,
             reviewed_at = now(),
             review_reason = $4,
             version = version + 1,
             updated_at = now()
         WHERE id = $1`,
        [command.participationId, command.decision, command.actorId, command.reason],
      )
      await this.writeAudit(connection, {
        actorId: command.actorId,
        requestId: command.requestId,
        contestId: command.contestId,
        participationId: command.participationId,
        action: 'contest.participation.reviewed',
        reason: command.reason,
        changes: { status: command.decision },
      })
      const result = await this.readById(connection, command.contestId, command.participationId)
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

  async assignDivision(command: ParticipationDivisionCommand): Promise<ParticipationRecord> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const teamId = await this.locateParticipationTeam(connection, command.contestId, command.participationId)
      await this.lockTeam(connection, teamId)
      await this.lockContest(connection, command.contestId)
      const current = await connection.query<{ status: ParticipationStatus }>(
        'SELECT status::text FROM participations WHERE id = $1 AND contest_id = $2 FOR UPDATE',
        [command.participationId, command.contestId],
      )
      if (!current.rows[0]) throw new ParticipationNotFoundError()
      if (current.rows[0].status === 'withdrawn') throw new ParticipationTransitionInvalidError()
      if (command.divisionId) {
        const division = await connection.query(
          'SELECT 1 FROM divisions WHERE id = $1 AND contest_id = $2',
          [command.divisionId, command.contestId],
        )
        if (!division.rows[0]) throw new ParticipationDivisionInvalidError()
      }
      await connection.query(
        `UPDATE participations
         SET division_id = $2, version = version + 1, updated_at = now()
         WHERE id = $1`,
        [command.participationId, command.divisionId],
      )
      await this.writeAudit(connection, {
        actorId: command.actorId,
        requestId: command.requestId,
        contestId: command.contestId,
        participationId: command.participationId,
        action: 'contest.participation.division_assigned',
        reason: command.reason,
        changes: { division_id: command.divisionId },
      })
      const result = await this.readById(connection, command.contestId, command.participationId)
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

  async list(
    contestId: string,
    cursor: string | undefined,
    limit: number,
    status: ParticipationStatus | undefined,
  ): Promise<ParticipationPage> {
    const contest = await this.pool.query('SELECT 1 FROM contests WHERE id = $1', [contestId])
    if (!contest.rows[0]) throw new ParticipationContestNotFoundError()
    const parameters: unknown[] = [contestId]
    const conditions = ['p.contest_id = $1']
    if (cursor) {
      parameters.push(cursor)
      conditions.push(`p.id > $${parameters.length}`)
    }
    if (status) {
      parameters.push(status)
      conditions.push(`p.status = $${parameters.length}`)
    }
    parameters.push(limit + 1)
    const result = await this.pool.query<ParticipationRow>(
      `${this.participationSelect()}
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.id
       LIMIT $${parameters.length}`,
      parameters,
    )
    const hasMore = result.rows.length > limit
    const rows = result.rows.slice(0, limit)
    return {
      items: rows.map(row => this.record(row)),
      nextCursor: hasMore ? rows.at(-1)!.id : null,
      hasMore,
    }
  }

  private async lockActorTeam(connection: PoolClient, userId: string) {
    const located = await connection.query<{ team_id: string }>(
      'SELECT team_id FROM team_members WHERE user_id = $1',
      [userId],
    )
    if (!located.rows[0]) throw new ParticipationTeamRequiredError()
    await this.lockTeam(connection, located.rows[0].team_id)
    const team = await connection.query<{
      id: string
      name: string
      role: 'member' | 'captain'
    }>(
      `SELECT t.id, t.name, m.role::text
       FROM team_members m
       JOIN teams t ON t.id = m.team_id
       WHERE m.user_id = $1 AND m.team_id = $2
       FOR UPDATE OF m`,
      [userId, located.rows[0].team_id],
    )
    if (!team.rows[0]) throw new ParticipationTeamRequiredError()
    return team.rows[0]
  }

  private async lockTeam(connection: PoolClient, teamId: string) {
    const result = await connection.query('SELECT 1 FROM teams WHERE id = $1 FOR UPDATE', [teamId])
    if (!result.rows[0]) throw new ParticipationTeamRequiredError()
  }

  private async lockContest(connection: PoolClient, contestId: string): Promise<LockedContest> {
    const result = await connection.query<{
      id: string
      publication_status: LockedContest['publicationStatus']
      registration_strategy: LockedContest['registrationStrategy']
      visibility: LockedContest['visibility']
      invite_digest: Buffer | null
      registration_open: boolean
      min_team_size: number
      max_team_size: number
      registration_constraints: unknown
    }>(
      `SELECT id, publication_status::text, registration_strategy::text, visibility::text,
              invite_digest, end_at > now() AS registration_open,
              min_team_size, max_team_size, registration_constraints
       FROM contests
       WHERE id = $1
       FOR UPDATE`,
      [contestId],
    )
    const row = result.rows[0]
    if (!row) throw new ParticipationContestNotFoundError()
    return {
      id: row.id,
      publicationStatus: row.publication_status,
      registrationStrategy: row.registration_strategy,
      visibility: row.visibility,
      inviteDigest: row.invite_digest,
      registrationOpen: row.registration_open,
      minTeamSize: row.min_team_size,
      maxTeamSize: row.max_team_size,
      registrationConstraints: row.registration_constraints,
    }
  }

  private requireRegistrationOpen(contest: LockedContest) {
    if (contest.publicationStatus !== 'published' || !contest.registrationOpen) {
      throw new ParticipationRegistrationClosedError()
    }
    if (contest.visibility === 'private' && !contest.inviteDigest) {
      throw new ParticipationConfigurationInvalidError()
    }
  }

  private verifySubmittedInvite(contest: LockedContest, submitted: Buffer | null): Buffer | null {
    if (!contest.inviteDigest) return null
    if (!submitted || !this.safeDigestEqual(contest.inviteDigest, submitted)) {
      throw new ParticipationInviteInvalidError()
    }
    return contest.inviteDigest
  }

  private verifyInviteEvidence(contest: LockedContest, evidence: Buffer | null) {
    if (!contest.inviteDigest) return
    if (!evidence || !this.safeDigestEqual(contest.inviteDigest, evidence)) {
      throw new ParticipationInviteInvalidError()
    }
  }

  private safeDigestEqual(expected: Buffer, actual: Buffer) {
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }

  private async validateTeamEligibility(connection: PoolClient, teamId: string, contest: LockedContest) {
    const members = await connection.query<{
      email_normalized: string
      email_verified_at: Date | null
      status: 'active' | 'banned' | 'deleted'
      must_change_password: boolean
    }>(
      `SELECT u.email_normalized, u.email_verified_at, u.status::text, u.must_change_password
       FROM team_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.team_id = $1
       ORDER BY m.user_id`,
      [teamId],
    )
    const actual = members.rows.length
    if (actual < contest.minTeamSize || actual > contest.maxTeamSize) {
      throw new ParticipationTeamSizeError(contest.minTeamSize, contest.maxTeamSize, actual)
    }
    if (members.rows.some(member => member.status !== 'active'
      || !member.email_verified_at
      || member.must_change_password)) {
      throw new ParticipationMemberIneligibleError()
    }

    const allowedDomains = this.allowedEmailDomains(contest.registrationConstraints)
    if (allowedDomains.length && members.rows.some(member => {
      const domain = member.email_normalized.split('@').at(-1)
      return !domain || !allowedDomains.includes(domain)
    })) {
      throw new ParticipationEmailDomainForbiddenError()
    }
  }

  private allowedEmailDomains(value: unknown): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ParticipationConfigurationInvalidError()
    }
    const constraints = value as Record<string, unknown>
    if (Object.keys(constraints).some(key => key !== 'allowed_email_domains')) {
      throw new ParticipationConfigurationInvalidError()
    }
    if (constraints.allowed_email_domains === undefined) return []
    if (!Array.isArray(constraints.allowed_email_domains)
      || constraints.allowed_email_domains.some(domain => typeof domain !== 'string'
        || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(domain))) {
      throw new ParticipationConfigurationInvalidError()
    }
    return [...new Set(constraints.allowed_email_domains.map(domain => domain.toLowerCase()))]
  }

  private async defaultDivision(connection: PoolClient, contestId: string): Promise<string | null> {
    const result = await connection.query<{ id: string }>(
      'SELECT id FROM divisions WHERE contest_id = $1 ORDER BY sort_order, id LIMIT 2',
      [contestId],
    )
    return result.rows.length === 1 ? result.rows[0]!.id : null
  }

  private async locateParticipationTeam(connection: PoolClient, contestId: string, participationId: string) {
    const result = await connection.query<{ team_id: string }>(
      'SELECT team_id FROM participations WHERE id = $1 AND contest_id = $2',
      [participationId, contestId],
    )
    if (!result.rows[0]) throw new ParticipationNotFoundError()
    return result.rows[0].team_id
  }

  private async writeAudit(connection: PoolClient, input: {
    actorId: string
    requestId: string
    contestId: string
    participationId: string
    action: string
    reason: string | null
    changes: Record<string, unknown>
  }) {
    await connection.query(
      `INSERT INTO audit_events
         (actor_user_id, action, target_type, target_id, reason, outcome, request_id, changes, metadata)
       VALUES ($1, $2, 'participation', $3, $4, 'succeeded', $5, $6, $7)`,
      [
        input.actorId,
        input.action,
        input.participationId,
        input.reason,
        input.requestId,
        input.changes,
        { contest_id: input.contestId },
      ],
    )
  }

  private async readByTeam(
    connection: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    contestId: string,
    teamId: string,
  ): Promise<ParticipationRecord | null> {
    const result = await connection.query<ParticipationRow>(
      `${this.participationSelect()} WHERE p.contest_id = $1 AND p.team_id = $2`,
      [contestId, teamId],
    )
    return result.rows[0] ? this.record(result.rows[0]) : null
  }

  private async readById(
    connection: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    contestId: string,
    participationId: string,
  ): Promise<ParticipationRecord> {
    const result = await connection.query<ParticipationRow>(
      `${this.participationSelect()} WHERE p.contest_id = $1 AND p.id = $2`,
      [contestId, participationId],
    )
    if (!result.rows[0]) throw new ParticipationNotFoundError()
    return this.record(result.rows[0])
  }

  private participationSelect() {
    return `SELECT p.id, p.contest_id, p.team_id, t.name AS team_name,
                   p.division_id, d.name AS division_name, p.status::text,
                   p.registered_at, p.reviewed_at, p.review_reason,
                   p.withdrawn_at, p.version::text
            FROM participations p
            JOIN teams t ON t.id = p.team_id
            LEFT JOIN divisions d ON d.id = p.division_id`
  }

  private record(row: ParticipationRow): ParticipationRecord {
    return {
      id: row.id,
      contestId: row.contest_id,
      teamId: row.team_id,
      teamName: row.team_name,
      divisionId: row.division_id,
      divisionName: row.division_name,
      status: row.status,
      registeredAt: row.registered_at,
      reviewedAt: row.reviewed_at,
      reviewReason: row.review_reason,
      withdrawnAt: row.withdrawn_at,
      version: Number(row.version),
    }
  }
}
