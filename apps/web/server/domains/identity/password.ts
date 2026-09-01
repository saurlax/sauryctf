export interface PasswordHasher {
  hash(password: string): Promise<string>
  verify(passwordHash: string, password: string): Promise<boolean>
  needsRehash(passwordHash: string): boolean
}
