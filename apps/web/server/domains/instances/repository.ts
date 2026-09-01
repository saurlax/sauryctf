import type { ChallengeInstancePolicy } from '../../../shared/contracts/challenges'
import type { InstanceEntrypoint } from '../../../shared/contracts/instances'

export interface InstanceRecord {
  id: string
  contestId: string
  contestChallengeId: string
  participationId: string
  provider: 'docker' | 'kubernetes'
  desiredState: 'running' | 'stopped'
  desiredGeneration: number
  observedState: 'pending' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'unknown'
  observedGeneration: number
  expiresAt: Date | null
  entrypoints: InstanceEntrypoint[]
  lastObservedAt: Date | null
  lastErrorCode: string | null
  lastErrorSummary: string | null
  version: number
}

export interface InstanceLeasePolicy {
  initialDurationMs: number
  extensionDurationMs: number
  renewalWindowMs: number
  teamActiveLimit: number
}

export interface InstanceCommand {
  actorId: string
  requestId: string
  contestId: string
  challengeId: string
  at: Date
  policy: InstanceLeasePolicy
}

export interface InstanceRepository {
  read(command: Omit<InstanceCommand, 'requestId'>): Promise<InstanceRecord | null>
  start(command: InstanceCommand): Promise<InstanceRecord>
  renew(command: InstanceCommand): Promise<InstanceRecord>
  destroy(command: InstanceCommand): Promise<InstanceRecord>
}

export class InstanceUnavailableError extends Error {}
export class InstanceTeamRequiredError extends Error {}
export class InstanceParticipationNotAcceptedError extends Error {}
export class InstanceContestNotAvailableError extends Error {}
export class InstanceChallengeNotAvailableError extends Error {}
export class InstanceConfigurationInvalidError extends Error {
  constructor(readonly policy?: ChallengeInstancePolicy) {
    super('Instance runtime configuration is invalid')
  }
}
export class InstanceQuotaExceededError extends Error {}
export class InstanceNotRunningError extends Error {}
export class InstanceRenewalTooEarlyError extends Error {
  constructor(readonly renewableAt: Date) {
    super('Instance renewal window has not opened')
  }
}
