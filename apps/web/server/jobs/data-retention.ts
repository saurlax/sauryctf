export const auditRetentionMs = 365 * 24 * 60 * 60 * 1000
export const securityLogRetentionMs = 90 * 24 * 60 * 60 * 1000
export const officialContestFactsRetention = 'indefinite' as const

export interface RetentionBatchResult {
  auditDeleted: number
  securityLogsDeleted: number
}

export interface DataRetentionRepository {
  purgeExpired(input: {
    auditBefore: Date
    securityBefore: Date
    limit: number
  }): Promise<RetentionBatchResult>
}

export interface DataRetentionResult extends RetentionBatchResult {
  batches: number
  auditBefore: Date
  securityBefore: Date
  officialContestFacts: typeof officialContestFactsRetention
}

export class DataRetentionService {
  constructor(
    private readonly repository: DataRetentionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run(batchLimit = 1_000, maximumBatches = 10): Promise<DataRetentionResult> {
    const limit = boundedInteger(batchLimit, 1, 10_000, 'retention batch limit')
    const maxBatches = boundedInteger(maximumBatches, 1, 100, 'retention maximum batches')
    const at = this.now()
    if (!Number.isFinite(at.getTime())) throw new RangeError('Invalid retention clock')
    const auditBefore = new Date(at.getTime() - auditRetentionMs)
    const securityBefore = new Date(at.getTime() - securityLogRetentionMs)
    let auditDeleted = 0
    let securityLogsDeleted = 0
    let batches = 0

    while (batches < maxBatches) {
      const batch = await this.repository.purgeExpired({ auditBefore, securityBefore, limit })
      auditDeleted += boundedCount(batch.auditDeleted)
      securityLogsDeleted += boundedCount(batch.securityLogsDeleted)
      batches += 1
      if (batch.auditDeleted < limit && batch.securityLogsDeleted < limit) break
    }

    return {
      auditDeleted,
      securityLogsDeleted,
      batches,
      auditBefore,
      securityBefore,
      officialContestFacts: officialContestFactsRetention,
    }
  }
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`Invalid ${label}`)
  }
  return value
}

function boundedCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid retention deletion count')
  return value
}
