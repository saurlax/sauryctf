import { createHash, randomBytes } from 'node:crypto'
import type { IdentityTokenCodec } from '../../domains/identity/token'

export const identityTokenCodec: IdentityTokenCodec = {
  generate: () => randomBytes(32).toString('base64url'),
  digest: token => createHash('sha256').update(token, 'utf8').digest(),
}
