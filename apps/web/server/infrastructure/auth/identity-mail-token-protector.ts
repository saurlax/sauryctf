import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import type { IdentityMailTokenProtector } from '../../domains/identity/delivery'

const envelopeVersion = 1
const initializationVectorBytes = 12
const authenticationTagBytes = 16

export class AesGcmIdentityMailTokenProtector implements IdentityMailTokenProtector {
  private readonly key: Buffer

  constructor(secret: string) {
    if (secret.length < 32) throw new Error('Identity mail token protection requires a 32-character secret')
    this.key = createHash('sha256')
      .update('sauryctf:identity-mail-token:v1\0', 'utf8')
      .update(secret, 'utf8')
      .digest()
  }

  protect(token: string): string {
    const initializationVector = randomBytes(initializationVectorBytes)
    const cipher = createCipheriv('aes-256-gcm', this.key, initializationVector)
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
    return Buffer.concat([
      Buffer.from([envelopeVersion]),
      initializationVector,
      cipher.getAuthTag(),
      ciphertext,
    ]).toString('base64url')
  }

  reveal(envelope: string): string {
    const encoded = Buffer.from(envelope, 'base64url')
    const minimumLength = 1 + initializationVectorBytes + authenticationTagBytes + 1
    if (encoded.length < minimumLength || encoded[0] !== envelopeVersion) {
      throw new Error('Identity mail token envelope is invalid')
    }
    const initializationVector = encoded.subarray(1, 1 + initializationVectorBytes)
    const authenticationTag = encoded.subarray(
      1 + initializationVectorBytes,
      1 + initializationVectorBytes + authenticationTagBytes,
    )
    const ciphertext = encoded.subarray(1 + initializationVectorBytes + authenticationTagBytes)
    const decipher = createDecipheriv('aes-256-gcm', this.key, initializationVector)
    decipher.setAuthTag(authenticationTag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  }
}
