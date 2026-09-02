import type {
  SubmissionRateLimiter,
  SubmissionRateLimitDecision,
} from '../../domains/submissions/service'
import { rateLimitBucket, type RateLimitStore } from './rate-limit'

export class RateLimitStoreSubmissionLimiter implements SubmissionRateLimiter {
  constructor(private readonly store: RateLimitStore) {}

  consume(input: Parameters<SubmissionRateLimiter['consume']>[0]): Promise<SubmissionRateLimitDecision> {
    return this.store.consume(
      rateLimitBucket(input.scope, input.identity, input.action),
      input.limit,
      input.windowMs,
    )
  }

  consumeMany(inputs: Array<Parameters<SubmissionRateLimiter['consume']>[0]>): Promise<SubmissionRateLimitDecision[]> {
    return this.store.consumeMany(inputs.map(input => ({
      bucket: rateLimitBucket(input.scope, input.identity, input.action),
      limit: input.limit,
      windowMs: input.windowMs,
    })))
  }
}
