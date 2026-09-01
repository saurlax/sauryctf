export interface IdentityMailTokenProtector {
  protect(token: string): string
  reveal(envelope: string): string
}
