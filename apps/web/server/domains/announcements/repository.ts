export type AnnouncementStatus = 'scheduled' | 'published' | 'withdrawn'

export interface AnnouncementRecord {
  id: string
  contestId: string
  title: string
  body: string
  status: AnnouncementStatus
  publishAt: Date
  withdrawnAt: Date | null
  createdAt: Date
  updatedAt: Date
  version: number
}

export interface AnnouncementPage {
  items: AnnouncementRecord[]
  nextCursor: string | null
  hasMore: boolean
}

export interface CreateAnnouncementCommand {
  announcementId: string
  actorId: string
  requestId: string
  contestId: string
  title: string
  body: string
  publishAt: Date
}

export interface UpdateAnnouncementCommand {
  actorId: string
  requestId: string
  contestId: string
  announcementId: string
  expectedVersion: number
  reason: string
  title: string
  body: string
  publishAt: Date
}

export interface WithdrawAnnouncementCommand {
  actorId: string
  requestId: string
  contestId: string
  announcementId: string
  expectedVersion: number
  reason: string
}

export interface AnnouncementRepository {
  create(command: CreateAnnouncementCommand): Promise<AnnouncementRecord>
  readManaged(contestId: string, announcementId: string): Promise<AnnouncementRecord>
  listManaged(contestId: string, cursor: string | undefined, limit: number): Promise<AnnouncementPage>
  listPublic(contestId: string, cursor: string | undefined, limit: number): Promise<AnnouncementPage>
  update(command: UpdateAnnouncementCommand): Promise<AnnouncementRecord>
  withdraw(command: WithdrawAnnouncementCommand): Promise<AnnouncementRecord>
}

export class AnnouncementNotFoundError extends Error {}
export class AnnouncementContestNotFoundError extends Error {}
export class AnnouncementContestArchivedError extends Error {}
export class AnnouncementWithdrawnError extends Error {}
export class AnnouncementVersionConflictError extends Error {}
