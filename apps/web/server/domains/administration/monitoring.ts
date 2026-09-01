import type { MonitoringItem, MonitoringListRequest, MonitoringListResponse } from '../../../shared/contracts/monitoring'
import { identityCapability, requireIdentityCapability } from '../identity/capabilities'
import type { SessionSubject } from '../identity/repository'

export interface MonitoringRepository {
  list(query: MonitoringListRequest, now: Date, workerStaleAfterMs: number): Promise<MonitoringItem[]>
}

export class AdministrationMonitoringService {
  constructor(
    private readonly repository: MonitoringRepository,
    private readonly workerStaleAfterMs = 90_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(subject: SessionSubject, query: MonitoringListRequest): Promise<MonitoringListResponse> {
    requireIdentityCapability(subject, identityCapability.globalOperationsManage)
    const generatedAt = this.now()
    return {
      generated_at: generatedAt.toISOString(),
      source: 'postgresql',
      cache_observed_at: null,
      worker_stale_after_seconds: Math.ceil(this.workerStaleAfterMs / 1000),
      items: await this.repository.list(query, generatedAt, this.workerStaleAfterMs),
    }
  }
}
