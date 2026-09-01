import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SessionSubject } from '../identity/repository'
import { createDatabaseClient, type DatabaseClient } from '../../infrastructure/db/client'
import { runMigrations } from '../../infrastructure/db/migrate'
import { PostgresTeamRepository } from '../../infrastructure/db/team-repository'
import { TeamService } from './service'

const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL
const describeWithPostgres = adminConnectionString ? describe : describe.skip
const databaseName = `sauryctf_test_${randomUUID().replaceAll('-', '')}`
function quoted() { if (!/^sauryctf_test_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unexpected database'); return `"${databaseName}"` }

describeWithPostgres('team membership transactions', () => {
  let admin: Client
  let database: DatabaseClient
  let teams: TeamService
  let sequence = 0

  beforeAll(async () => {
    admin = new Client({ connectionString: adminConnectionString }); await admin.connect(); await admin.query(`CREATE DATABASE ${quoted()}`)
    const url = new URL(adminConnectionString!); url.pathname = `/${databaseName}`
    database = createDatabaseClient({ connectionString: url.toString(), maxConnections: 12 }); await runMigrations(database)
    teams = new TeamService(new PostgresTeamRepository(database.pool))
  })
  afterAll(async () => { if(database) await database.pool.end(); if(admin){ await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[databaseName]); await admin.query(`DROP DATABASE IF EXISTS ${quoted()}`); await admin.end() } })

  async function user(): Promise<SessionSubject> {
    sequence++
    const username=`TeamFlow${sequence}`; const email=`team-flow-${sequence}@example.test`
    const result=await database.pool.query<{id:string}>(`INSERT INTO users(username,username_normalized,email,email_normalized,email_verified_at) VALUES($1::varchar(64),lower($1::varchar(64)),$2::varchar(320),lower($2::varchar(320)),now()) RETURNING id`,[username,email])
    return { userId:result.rows[0]!.id,username,email,emailVerified:true,status:'active',role:'user',sessionVersion:1,mustChangePassword:false }
  }

  async function acceptTeamForContest(
    teamId: string,
    reviewerId: string,
    phase: 'active' | 'ended' = 'active',
  ) {
    sequence++
    const now = Date.now()
    const startAt = new Date(now - (phase === 'active' ? 60_000 : 7_200_000))
    const endAt = new Date(now + (phase === 'active' ? 3_600_000 : -3_600_000))
    const title = phase === 'active' ? `Locked Contest ${sequence}` : `Ended Contest ${sequence}`
    const contest = await database.pool.query<{ id: string }>(
      `INSERT INTO contests
         (title, slug, publication_status, start_at, end_at, published_at, created_by)
       VALUES ($1, $2, 'published', $3, $4, $3, $5)
       RETURNING id`,
      [title, `team-lock-${sequence}`, startAt, endAt, reviewerId],
    )
    await database.pool.query(
      `INSERT INTO participations
         (contest_id, team_id, status, registered_by, reviewed_by, reviewed_at)
       VALUES ($1, $2, 'accepted', $3, $3, now())`,
      [contest.rows[0]!.id, teamId, reviewerId],
    )
    return { id: contest.rows[0]!.id, title, startAt, endAt }
  }

  it('creates, joins, removes, leaves and rotates an unenumerable invite', async () => {
    const captain=await user(); const member=await user(); const leaving=await user()
    const created=await teams.create(captain,'Blue Team')
    await teams.join(member,created.inviteCode); await teams.join(leaving,created.inviteCode)
    await teams.remove(captain,member.userId)
    await teams.leave(leaving)
    const nextCode=await teams.rotateInvite(captain)
    await expect(teams.join(await user(),created.inviteCode)).rejects.toMatchObject({code:'team.invite_invalid'})
    await expect(teams.join(await user(),'u'.repeat(43))).rejects.toMatchObject({code:'team.invite_invalid'})
    await expect(teams.join(await user(),nextCode)).resolves.toMatchObject({name:'Blue Team'})
  })

  it('allows only the captain to remove members, rotate invites or transfer captaincy', async () => {
    const captain=await user(); const member=await user(); const target=await user()
    const created=await teams.create(captain,'Captain Boundary')
    await teams.join(member,created.inviteCode); await teams.join(target,created.inviteCode)

    await expect(teams.remove(member,target.userId)).rejects.toMatchObject({code:'team.forbidden'})
    await expect(teams.rotateInvite(member)).rejects.toMatchObject({code:'team.forbidden'})
    await expect(teams.transfer(member,target.userId)).rejects.toMatchObject({code:'team.forbidden'})

    const current=await teams.current(captain)
    expect(current?.members).toHaveLength(3)
    expect(current?.members.find(candidate=>candidate.role==='captain')?.userId).toBe(captain.userId)
  })

  it('locks every ordinary membership mutation while an accepted contest has not ended', async () => {
    const captain=await user(); const member=await user(); const target=await user(); const newcomer=await user()
    const created=await teams.create(captain,'Locked Team')
    await teams.join(member,created.inviteCode); await teams.join(target,created.inviteCode)
    const contest=await acceptTeamForContest(created.team.id,captain.userId)

    const current=await teams.current(captain)
    expect(current?.locks).toEqual([expect.objectContaining({id:contest.id,title:contest.title})])
    await expect(teams.join(newcomer,created.inviteCode)).rejects.toMatchObject({code:'team.locked'})
    await expect(teams.leave(member)).rejects.toMatchObject({code:'team.locked'})
    await expect(teams.remove(captain,target.userId)).rejects.toMatchObject({code:'team.locked'})
    await expect(teams.transfer(captain,target.userId)).rejects.toMatchObject({code:'team.locked'})
    await expect(teams.rotateInvite(captain)).resolves.toHaveLength(43)
  })

  it('unlocks ordinary membership mutations after every accepted contest ends', async () => {
    const captain=await user(); const member=await user()
    const created=await teams.create(captain,'Ended Lock Team')
    await teams.join(member,created.inviteCode)
    await acceptTeamForContest(created.team.id,captain.userId,'ended')

    await expect(teams.leave(member)).resolves.toBeUndefined()
    await expect(teams.current(captain)).resolves.toMatchObject({locks:[]})
  })

  it('serializes participation acceptance on the same team row used by membership changes', async () => {
    const captain=await user(); const created=await teams.create(captain,'Acceptance Lock Team')
    sequence++
    const contest=await database.pool.query<{id:string}>(
      `INSERT INTO contests
         (title,slug,publication_status,start_at,end_at,published_at,created_by)
       VALUES($1,$2,'published',now()-interval '1 minute',now()+interval '1 hour',now(),$3)
       RETURNING id`,[`Acceptance Lock ${sequence}`,`acceptance-lock-${sequence}`,captain.userId],
    )
    const blocker=await database.pool.connect(); const contender=await database.pool.connect()
    try {
      await blocker.query('BEGIN')
      await blocker.query('SELECT 1 FROM teams WHERE id=$1 FOR UPDATE',[created.team.id])
      await contender.query('BEGIN')
      await contender.query("SET LOCAL lock_timeout='100ms'")
      await expect(contender.query(
        `INSERT INTO participations
           (contest_id,team_id,status,registered_by,reviewed_by,reviewed_at)
         VALUES($1,$2,'accepted',$3,$3,now())`,[contest.rows[0]!.id,created.team.id,captain.userId],
      )).rejects.toMatchObject({code:'55P03'})
    }
    finally {
      await contender.query('ROLLBACK').catch(()=>undefined)
      await blocker.query('ROLLBACK').catch(()=>undefined)
      blocker.release(); contender.release()
    }
  })

  it('lets an admin correct a locked team with a reason and writes audit evidence atomically', async () => {
    const captain=await user(); const member=await user(); const replacement=await user(); const adminUser=await user()
    const admin={...adminUser,role:'admin' as const}
    const created=await teams.create(captain,'Corrected Team')
    await teams.join(member,created.inviteCode)
    const contest=await acceptTeamForContest(created.team.id,admin.userId)

    await teams.correctMembership(admin,{
      requestId:randomUUID(),teamId:created.team.id,operation:'remove_member',targetUserId:member.userId,reason:'Remove an ineligible registered member',
    })
    await teams.correctMembership(admin,{
      requestId:randomUUID(),teamId:created.team.id,operation:'add_member',targetUserId:replacement.userId,reason:'Restore the approved replacement member',
    })
    const corrected=await teams.correctMembership(admin,{
      requestId:randomUUID(),teamId:created.team.id,operation:'transfer_captain',targetUserId:replacement.userId,reason:'Transfer captaincy after identity review',
    })

    expect(corrected.members.find(candidate=>candidate.role==='captain')?.userId).toBe(replacement.userId)
    expect(corrected.locks).toEqual([expect.objectContaining({id:contest.id})])
    const audit=await database.pool.query<{reason:string,changes:{operation:string},metadata:{locked_contests:Array<{id:string}>}}>(
      `SELECT reason,changes,metadata FROM audit_events
       WHERE target_id=$1 AND action='team.membership.corrected'
       ORDER BY occurred_at,id`,[created.team.id],
    )
    expect(audit.rows).toHaveLength(3)
    expect(audit.rows.map(row=>row.changes.operation)).toEqual(['remove_member','add_member','transfer_captain'])
    expect(audit.rows.every(row=>row.reason.length>=10)).toBe(true)
    expect(audit.rows.every(row=>row.metadata.locked_contests[0]?.id===contest.id)).toBe(true)
  })

  it('rolls back audit evidence when an administrative correction fails', async () => {
    const captain=await user(); const adminUser=await user(); const admin={...adminUser,role:'admin' as const}
    const created=await teams.create(captain,'Failed Correction')
    await acceptTeamForContest(created.team.id,admin.userId)
    const requestId=randomUUID()

    await expect(teams.correctMembership(admin,{
      requestId,teamId:created.team.id,operation:'remove_member',targetUserId:captain.userId,reason:'Invalid attempt to remove the captain',
    })).rejects.toMatchObject({code:'team.forbidden'})
    const audit=await database.pool.query('SELECT 1 FROM audit_events WHERE request_id=$1',[requestId])
    expect(audit.rows).toHaveLength(0)
  })

  it('allows only one concurrent team join for the same user', async () => {
    const [captainA,captainB,joining]=await Promise.all([user(),user(),user()])
    const [a,b]=await Promise.all([teams.create(captainA,'Concurrent A'),teams.create(captainB,'Concurrent B')])
    const outcomes=await Promise.allSettled([teams.join(joining,a.inviteCode),teams.join(joining,b.inviteCode)])
    expect(outcomes.filter(item=>item.status==='fulfilled')).toHaveLength(1)
    expect(outcomes.filter(item=>item.status==='rejected')).toHaveLength(1)
  })

  it('serializes concurrent captain transfers and preserves one captain', async () => {
    const captain=await user(); const first=await user(); const second=await user()
    const created=await teams.create(captain,'Transfer Team')
    await teams.join(first,created.inviteCode); await teams.join(second,created.inviteCode)
    const outcomes=await Promise.allSettled([teams.transfer(captain,first.userId),teams.transfer(captain,second.userId)])
    expect(outcomes.filter(item=>item.status==='fulfilled')).toHaveLength(1)
    const team=await teams.current(first)
    expect(team?.members.filter(member=>member.role==='captain')).toHaveLength(1)
  })
})
