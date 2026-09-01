import type { Pool, PoolClient } from 'pg'
import {
  TeamConflictError,
  TeamForbiddenError,
  TeamInviteInvalidError,
  TeamNotFoundError,
  type CreatedTeam,
  type TeamRecord,
  type TeamRepository,
} from '../../domains/teams/repository'

function unique(error: unknown) { return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505' }

export class PostgresTeamRepository implements TeamRepository {
  constructor(private pool: Pool) {}

  async findByUser(userId: string): Promise<TeamRecord | null> {
    const team = await this.pool.query<{ team_id: string }>('SELECT team_id FROM team_members WHERE user_id = $1', [userId])
    return team.rows[0] ? this.readTeam(this.pool, team.rows[0].team_id) : null
  }

  async create(name: string, normalizedName: string, captainId: string, inviteDigest: Buffer, inviteCode: string): Promise<CreatedTeam> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const result = await connection.query<{ id: string }>('INSERT INTO teams (name, name_normalized, created_by) VALUES ($1,$2,$3) RETURNING id', [name, normalizedName, captainId])
      const teamId = result.rows[0]!.id
      await connection.query("INSERT INTO team_members (team_id,user_id,role) VALUES ($1,$2,'captain')", [teamId, captainId])
      await connection.query('INSERT INTO team_invites (team_id,token_digest,generation,created_by) VALUES ($1,$2,1,$3)', [teamId, inviteDigest, captainId])
      const team = await this.readTeam(connection, teamId)
      await connection.query('COMMIT')
      return { team, inviteCode }
    }
    catch (error) { await connection.query('ROLLBACK'); if (unique(error)) throw new TeamConflictError(); throw error }
    finally { connection.release() }
  }

  async join(userId: string, inviteDigest: Buffer): Promise<TeamRecord> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const invite = await connection.query<{ team_id: string }>(`SELECT team_id FROM team_invites WHERE token_digest=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE`, [inviteDigest])
      if (!invite.rows[0]) throw new TeamInviteInvalidError()
      await connection.query('INSERT INTO team_members (team_id,user_id) VALUES ($1,$2)', [invite.rows[0].team_id, userId])
      await connection.query('UPDATE teams SET version=version+1, updated_at=now() WHERE id=$1', [invite.rows[0].team_id])
      const team = await this.readTeam(connection, invite.rows[0].team_id)
      await connection.query('COMMIT')
      return team
    }
    catch (error) { await connection.query('ROLLBACK'); if (unique(error)) throw new TeamConflictError(); throw error }
    finally { connection.release() }
  }

  async leave(userId: string): Promise<void> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const member = await connection.query<{ team_id: string, role: string }>('SELECT team_id,role::text FROM team_members WHERE user_id=$1 FOR UPDATE', [userId])
      if (!member.rows[0]) throw new TeamNotFoundError()
      if (member.rows[0].role === 'captain') throw new TeamForbiddenError()
      await connection.query('DELETE FROM team_members WHERE user_id=$1', [userId])
      await connection.query('UPDATE teams SET version=version+1, updated_at=now() WHERE id=$1', [member.rows[0].team_id])
      await connection.query('COMMIT')
    }
    catch (error) { await connection.query('ROLLBACK'); throw error }
    finally { connection.release() }
  }

  async removeMember(actorId: string, memberId: string): Promise<void> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const actor = await this.requireCaptain(connection, actorId)
      const target = await connection.query<{ role: string }>('SELECT role::text FROM team_members WHERE team_id=$1 AND user_id=$2 FOR UPDATE', [actor.teamId, memberId])
      if (!target.rows[0]) throw new TeamNotFoundError()
      if (target.rows[0].role === 'captain') throw new TeamForbiddenError()
      await connection.query('DELETE FROM team_members WHERE team_id=$1 AND user_id=$2', [actor.teamId, memberId])
      await connection.query('UPDATE teams SET version=version+1, updated_at=now() WHERE id=$1', [actor.teamId])
      await connection.query('COMMIT')
    }
    catch (error) { await connection.query('ROLLBACK'); throw error }
    finally { connection.release() }
  }

  async rotateInvite(actorId: string, inviteDigest: Buffer, inviteCode: string): Promise<string> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const actor = await this.requireCaptain(connection, actorId)
      const generation = await connection.query<{ next: number }>('SELECT COALESCE(max(generation),0)+1 AS next FROM team_invites WHERE team_id=$1', [actor.teamId])
      await connection.query('UPDATE team_invites SET revoked_at=now() WHERE team_id=$1 AND revoked_at IS NULL', [actor.teamId])
      await connection.query('INSERT INTO team_invites (team_id,token_digest,generation,created_by) VALUES ($1,$2,$3,$4)', [actor.teamId, inviteDigest, generation.rows[0]!.next, actorId])
      await connection.query('COMMIT')
      return inviteCode
    }
    catch (error) { await connection.query('ROLLBACK'); if (unique(error)) throw new TeamConflictError(); throw error }
    finally { connection.release() }
  }

  async transferCaptain(actorId: string, memberId: string): Promise<void> {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const actor = await this.requireCaptain(connection, actorId)
      if (actorId === memberId) throw new TeamForbiddenError()
      const target = await connection.query('SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 FOR UPDATE', [actor.teamId, memberId])
      if (!target.rows[0]) throw new TeamNotFoundError()
      await connection.query("UPDATE team_members SET role='member' WHERE team_id=$1 AND user_id=$2", [actor.teamId, actorId])
      await connection.query("UPDATE team_members SET role='captain' WHERE team_id=$1 AND user_id=$2", [actor.teamId, memberId])
      await connection.query('UPDATE teams SET version=version+1, updated_at=now() WHERE id=$1', [actor.teamId])
      await connection.query('COMMIT')
    }
    catch (error) { await connection.query('ROLLBACK'); throw error }
    finally { connection.release() }
  }

  private async requireCaptain(connection: PoolClient, userId: string) {
    const result = await connection.query<{ team_id: string, role: string }>('SELECT team_id,role::text FROM team_members WHERE user_id=$1 FOR UPDATE', [userId])
    if (!result.rows[0]) throw new TeamNotFoundError()
    if (result.rows[0].role !== 'captain') throw new TeamForbiddenError()
    return { teamId: result.rows[0].team_id }
  }

  private async readTeam(connection: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>, teamId: string): Promise<TeamRecord> {
    const team = await connection.query<{ id: string, name: string, version: string }>('SELECT id,name,version::text FROM teams WHERE id=$1', [teamId])
    if (!team.rows[0]) throw new TeamNotFoundError()
    const members = await connection.query<{ user_id: string, username: string, role: 'member'|'captain', joined_at: Date }>(`SELECT m.user_id,u.username,m.role::text,m.joined_at FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=$1 ORDER BY m.joined_at,m.id`, [teamId])
    return { id: team.rows[0].id, name: team.rows[0].name, version: Number(team.rows[0].version), members: members.rows.map(row => ({ userId: row.user_id, username: row.username, role: row.role, joinedAt: row.joined_at })) }
  }
}
