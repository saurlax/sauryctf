import type { IssuedIdentityToken } from './token'

export interface IdentityTokenDeliveryMessage extends IssuedIdentityToken {
  userId: string
  recipient: string
}

export interface IdentityTokenDelivery {
  deliver(message: IdentityTokenDeliveryMessage): Promise<void>
}

/**
 * Token persistence and validation are already authoritative in PostgreSQL.
 * The mail outbox adapter replaces this transitional sink in task 4.11; keeping
 * the port explicit prevents HTTP handlers from returning or logging raw tokens.
 */
export class DeferredIdentityTokenDelivery implements IdentityTokenDelivery {
  async deliver(_message: IdentityTokenDeliveryMessage): Promise<void> {}
}
