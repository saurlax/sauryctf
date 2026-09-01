import { z } from 'zod'
import type {
  HumanVerificationInput,
  HumanVerificationProvider,
} from '../../domains/identity/human-verification'

const turnstileResponseSchema = z.looseObject({
  success: z.boolean(),
  action: z.string().optional(),
  'error-codes': z.array(z.string()).optional(),
})

type Fetcher = typeof fetch

export class TurnstileHumanVerificationProvider implements HumanVerificationProvider {
  readonly required = true

  constructor(
    private readonly secretKey: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly endpoint = 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  ) {}

  async verify(input: HumanVerificationInput): Promise<boolean> {
    if (!input.token) return false
    const body = new URLSearchParams({
      secret: this.secretKey,
      response: input.token,
    })
    if (input.remoteIp) body.set('remoteip', input.remoteIp)

    try {
      const response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) return false
      const parsed = turnstileResponseSchema.safeParse(await response.json())
      return parsed.success && parsed.data.success && parsed.data.action === input.action
    }
    catch {
      return false
    }
  }
}
