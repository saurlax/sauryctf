import type { Pool, PoolClient } from 'pg'
import {
  TeamConflictError,
  TeamForbiddenError,
  TeamInviteInvalidError,
  TeamLockedError,
  TeamMemberIneligibleError,
  TeamNotFoundError,
  type CreatedTeam,
  type TeamCorrectionCommand,
  type TeamLockRecord,
  type TeamRecord,
  type TeamRepository,
} from '../../domains/teams/repository'

function isUniqueViolation(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: string }).code === '23505'
}

export class PostgresTeamRepository implements TeamRepository {
  constructor(private pool: Pool) {}

  async findByUser(userId: string): Promise<TeamRecord | null> {
    const result = await this.pool.query<{ team_id: string }>(
      'SELECT team_id FROM team_members WHERE user_id = $1',
      [userId],
    )
    return result.rows[0] ? this.readTeam(this.pool, result.rows[0].team_id) : null
  }

  async create(
    name: string,
    normalizedName: string,
    captainId: string,
    inviteDigest: Buffer,
    inviteCode: string,
  ): Promise<CreatedTeam> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const result = await connection.query<{ id: string }>(
        'INSERT INTO teams (name, name_normalized, created_by) VALUES ($1, $2, $3) RETURNING id',
        [name, normalizedName, captainId],
      )
      const teamId = result.rows[0]!.id
      await connection.query(
        "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'captain')",
        [teamId, captainId],
      )
      await connection.query(
        'INSERT INTO team_invites (team_id, token_digest, generation, created_by) VALUES ($1, $2, 1, $3)',
        [teamId, inviteDigest, captainId],
      )
      const team = await this.readTeam(connection, teamId)
      await connection.query('COMMIT')
      return { team, inviteCode }
    }
    catch (error) {
      await connection.query('ROLLBACK')
      if (isUniqueViolation(error)) throw new TeamConflictError()
      throw error
    }
    finally {
      connection.release()
    }
  }

  async join(userId: string, inviteDigest: Buffer): Promise<TeamRecord> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const located = await connection.query<{ team_id: string }>(
        `SELECT team_id
         FROM team_invites
         WHERE token_digest = $1
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > now())`,
        [inviteDigest],
      )
      if (!located.rows[0]) throw new TeamInviteInvalidError()
      const teamId = located.rows[0].team_id

      await this.requireUnlockedTeam(connection, teamId)
      const invite = await connection.query(
        `SELECT 1
         FROM team_invites
         WHERE team_id = $1
           AND token_digest = $2
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > now())
         FOR UPDATE`,
        [teamId, inviteDigest],
      )
      if (!invite.rows[0]) throw new TeamInviteInvalidError()

      await connection.query(
        'INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)',
        [teamId, userId],
      )
      await this.incrementVersion(connection, teamId)
      const team = await this.readTeam(connection, teamId)
      await connection.query('COMMIT')
      return team
    }
    catch (error) {
      await connection.query('ROLLBACK')
      if (isUniqueViolation(error)) throw new TeamConflictError()
      throw error
    }
    finally {
      connection.release()
    }
  }

  async leave(userId: string): Promise<void> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const located = await this.findTeamForUser(connection, userId)
      await this.requireUnlockedTeam(connection, located)
      const member = await connection.query<{ role: string }>(
        'SELECT role::text FROM team_members WHERE team_id = $1 AND user_id = $2 FOR UPDATE',
        [located, userId],
      )
      if (!member.rows[0]) throw new TeamNotFoundError()
      if (member.rows[0].role === 'captain') throw new TeamForbiddenError()
      await connection.query(
        'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2',
        [located, userId],
      )
      await this.incrementVersion(connection, located)
      await connection.query('COMMIT')
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
  }

  async removeMember(actorId: string, memberId: string): Promise<void> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const actor = await this.requireCaptain(connection, actorId, true)
      const target = await connection.query<{ role: string }>(
        'SELECT role::text FROM team_members WHERE team_id = $1 AND user_id = $2 FOR UPDATE',
        [actor.teamId, memberId],
      )
      if (!target.rows[0]) throw new TeamNotFoundError()
      if (target.rows[0].role === 'captain') throw new TeamForbiddenError()
      await connection.query(
        'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2',
        [actor.teamId, memberId],
      )
      await this.incrementVersion(connection, actor.teamId)
      await connection.query('COMMIT')
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
  }

  async rotateInvite(actorId: string, inviteDigest: Buffer, inviteCode: string): Promise<string> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const actor = await this.requireCaptain(connection, actorId, false)
      const generation = await connection.query<{ next: number }>(
        'SELECT COALESCE(max(generation), 0) + 1 AS next FROM team_invites WHERE team_id = $1',
        [actor.teamId],
      )
      await connection.query(
        'UPDATE team_invites SET revoked_at = now() WHERE team_id = $1 AND revoked_at IS NULL',
        [actor.teamId],
      )
      await connection.query(
        'INSERT INTO team_invites (team_id, token_digest, generation, created_by) VALUES ($1, $2, $3, $4)',
        [actor.teamId, inviteDigest, generation.rows[0]!.next, actorId],
      )
      await this.incrementVersion(connection, actor.teamId)
      await connection.query('COMMIT')
      return inviteCode
    }
    catch (error) {
      await connection.query('ROLLBACK')
      if (isUniqueViolation(error)) throw new TeamConflictError()
      throw error
    }
    finally {
      connection.release()
    }
  }

  async transferCaptain(actorId: string, memberId: string): Promise<void> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const actor = await this.requireCaptain(connection, actorId, true)
      if (actorId === memberId) throw new TeamForbiddenError()
      const target = await connection.query(
        'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2 FOR UPDATE',
        [actor.teamId, memberId],
      )
      if (!target.rows[0]) throw new TeamNotFoundError()
      await this.assignCaptain(connection, actor.teamId, memberId)
      await this.incrementVersion(connection, actor.teamId)
      await connection.query('COMMIT')
    }
    catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
    finally {
      connection.release()
    }
  }

  async correctMembership(command: TeamCorrectionCommand): Promise<TeamRecord> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const locks = await this.lockTeam(connection, command.teamId)

      if (command.operation === 'add_member') {
        const target = await connection.query(
          `SELECT 1
           FROM users
           WHERE id = $1
             AND status = 'active'
             AND email_verified_at IS NOT NULL
             AND must_change_password = false
           FOR UPDATE`,
          [command.targetUserId],
        )
        if (!target.rows[0]) throw new TeamMemberIneligibleError()
        await connection.query(
          'INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)',
          [command.teamId, command.targetUserId],
        )
      }
      else if (command.operation === 'remove_member') {
        const target = await connection.query<{ role: string }>(
          'SELECT role::text FROM team_members WHERE team_id = $1 AND user_id = $2 FOR UPDATE',
          [command.teamId, command.targetUserId],
        )
        if (!target.rows[0]) throw new TeamNotFoundError()
        if (target.rows[0].role === 'captain') throw new TeamForbiddenError()
        await connection.query(
          'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2',
          [command.teamId, command.targetUserId],
        )
      }
      else {
        const target = await connection.query<{ role: string }>(
          'SELECT role::text FROM team_members WHERE team_id = $1 AND user_id = $2 FOR UPDATE',
          [command.teamId, command.targetUserId],
        )
        if (!target.rows[0]) throw new TeamNotFoundError()
        if (target.rows[0].role === 'captain') throw new TeamForbiddenError()
        await this.assignCaptain(connection, command.teamId, command.targetUserId)
      }

      await this.incrementVersion(connection, command.teamId)
      await connection.query(
        `INSERT INTO audit_events
           (actor_user_id, action, target_type, target_id, reason, outcome, request_id, changes, metadata)
         VALUES ($1, 'team.membership.corrected', 'team', $2, $3, 'succeeded', $4, $5, $6)`,
        [
          command.actorId,
          command.teamId,
          command.reason,
          command.requestId,
          { operation: command.operation, user_id: command.targetUserId },
          { locked_contests: locks.map(lock => ({ id: lock.id, title: lock.title })) },
        ],
      )
      const team = await this.readTeam(connection, command.teamId)
      await connection.query('COMMIT')
      return team
    }
    catch (error) {
      await connection.query('ROLLBACK')
      if (isUniqueViolation(error)) throw new TeamConflictError()
      throw error
    }
    finally {
      connection.release()
    }
  }

  private async findTeamForUser(connection: PoolClient, userId: string): Promise<string> {
    const result = await connection.query<{ team_id: string }>(
      'SELECT team_id FROM team_members WHERE user_id = $1',
      [userId],
    )
    if (!result.rows[0]) throw new TeamNotFoundError()
    return result.rows[0].team_id
  }

  private async requireCaptain(connection: PoolClient, userId: string, requireUnlocked: boolean) {
    const teamId = await this.findTeamForUser(connection, userId)
    const locks = await this.lockTeam(connection, teamId)
    if (requireUnlocked && locks.length) throw new TeamLockedError(locks)
    const member = await connection.query<{ role: string }>(
      'SELECT role::text FROM team_members WHERE team_id = $1 AND user_id = $2 FOR UPDATE',
      [teamId, userId],
    )
    if (!member.rows[0]) throw new TeamNotFoundError()
    if (member.rows[0].role !== 'captain') throw new TeamForbiddenError()
    return { teamId }
  }

  private async requireUnlockedTeam(connection: PoolClient, teamId: string): Promise<void> {
    const locks = await this.lockTeam(connection, teamId)
    if (locks.length) throw new TeamLockedError(locks)
  }

  private async lockTeam(connection: PoolClient, teamId: string): Promise<TeamLockRecord[]> {
    const team = await connection.query('SELECT 1 FROM teams WHERE id = $1 FOR UPDATE', [teamId])
    if (!team.rows[0]) throw new TeamNotFoundError()
    return this.readLocks(connection, teamId)
  }

  private async assignCaptain(connection: PoolClient, teamId: string, memberId: string) {
    await connection.query(
      "UPDATE team_members SET role = 'member' WHERE team_id = $1 AND role = 'captain'",
      [teamId],
    )
    await connection.query(
      "UPDATE team_members SET role = 'captain' WHERE team_id = $1 AND user_id = $2",
      [teamId, memberId],
    )
  }

  private async incrementVersion(connection: PoolClient, teamId: string) {
    await connection.query(
      'UPDATE teams SET version = version + 1, updated_at = now() WHERE id = $1',
      [teamId],
    )
  }

  private async readLocks(
    connection: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    teamId: string,
  ): Promise<TeamLockRecord[]> {
    const result = await connection.query<{
      id: string
      title: string
      start_at: Date
      end_at: Date
    }>(
      `SELECT c.id, c.title, c.start_at, c.end_at
       FROM participations p
       JOIN contests c ON c.id = p.contest_id
       WHERE p.team_id = $1
         AND p.status = 'accepted'
         AND derive_contest_time_phase(c.start_at, c.end_at, CURRENT_TIMESTAMP) <> 'ended'
       ORDER BY c.end_at, c.id`,
      [teamId],
    )
    return result.rows.map(row => ({
      id: row.id,
      title: row.title,
      startAt: row.start_at,
      endAt: row.end_at,
    }))
  }

  private async readTeam(
    connection: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    teamId: string,
  ): Promise<TeamRecord> {
    const team = await connection.query<{ id: string, name: string, version: string }>(
      'SELECT id, name, version::text FROM teams WHERE id = $1',
      [teamId],
    )
    if (!team.rows[0]) throw new TeamNotFoundError()
    const members = await connection.query<{
      user_id: string
      username: string
      role: 'member' | 'captain'
      joined_at: Date
    }>(
      `SELECT m.user_id, u.username, m.role::text, m.joined_at
       FROM team_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.team_id = $1
       ORDER BY m.joined_at, m.id`,
      [teamId],
    )
    return {
      id: team.rows[0].id,
      name: team.rows[0].name,
      version: Number(team.rows[0].version),
      members: members.rows.map(row => ({
        userId: row.user_id,
        username: row.username,
        role: row.role,
        joinedAt: row.joined_at,
      })),
      locks: await this.readLocks(connection, teamId),
    }
  }
}
