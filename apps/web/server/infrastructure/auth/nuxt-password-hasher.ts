import type { PasswordHasher } from '../../domains/identity/password'

// These helpers are provided by nuxt-auth-utils as Nitro server auto-imports.
export const nuxtPasswordHasher: PasswordHasher = {
  hash: password => hashPassword(password),
  verify: (passwordHash, password) => verifyPassword(passwordHash, password),
  needsRehash: passwordHash => passwordNeedsReHash(passwordHash),
}
