export interface ClaimedMailDelivery {
  id: string
  recipient: string
  templateKey: string
  payload: Record<string, unknown>
  attemptCount: number
  maxAttempts: number
}

export interface MailOutboxRepository {
  claim(workerId: string, claimedAt: Date, leaseUntil: Date, limit: number): Promise<ClaimedMailDelivery[]>
  markSent(deliveryId: string, workerId: string, sentAt: Date): Promise<boolean>
  markFailed(
    deliveryId: string,
    workerId: string,
    failedAt: Date,
    retryAt: Date,
    terminal: boolean,
    errorCode: string,
  ): Promise<boolean>
}

export interface MailTransportMessage extends ClaimedMailDelivery {
  messageId: string
}

export interface MailTransport {
  send(message: MailTransportMessage): Promise<void>
}

export class MailOutboxDispatcher {
  constructor(
    private readonly workerId: string,
    private readonly repository: MailOutboxRepository,
    private readonly transport: MailTransport,
    private readonly now: () => Date = () => new Date(),
    private readonly leaseMs = 30_000,
  ) {}

  async runOnce(limit = 20): Promise<number> {
    const claimedAt = this.now()
    const deliveries = await this.repository.claim(
      this.workerId,
      claimedAt,
      new Date(claimedAt.getTime() + this.leaseMs),
      limit,
    )
    await Promise.all(deliveries.map(delivery => this.deliver(delivery)))
    return deliveries.length
  }

  private async deliver(delivery: ClaimedMailDelivery): Promise<void> {
    try {
      await this.transport.send({
        ...delivery,
        messageId: `<${delivery.id}@mail.sauryctf>`,
      })
      await this.repository.markSent(delivery.id, this.workerId, this.now())
    }
    catch (error) {
      const failedAt = this.now()
      const terminal = delivery.attemptCount >= delivery.maxAttempts
      const backoffMs = Math.min(5 * 60_000, 1_000 * 2 ** Math.max(0, delivery.attemptCount - 1))
      await this.repository.markFailed(
        delivery.id,
        this.workerId,
        failedAt,
        new Date(failedAt.getTime() + backoffMs),
        terminal,
        error instanceof Error ? error.name.slice(0, 120) : 'UnknownError',
      )
    }
  }
}
