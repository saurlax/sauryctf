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
