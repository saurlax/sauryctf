import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto'
import type {
  ProtectedSubmissionAnswer,
  SubmissionAnswerContext,
  SubmissionAnswerProtector,
} from '../../domains/submissions/answer-protection'

const envelopeMagic = Buffer.from('SCAS', 'ascii')
const envelopeVersion = 1
const nonceLength = 12
const tagLength = 16

export class SubmissionAnswerProtectionError extends Error {
  constructor() {
    super('提交答案保护配置或密文无效')
    this.name = 'SubmissionAnswerProtectionError'
  }
}

export class AesGcmSubmissionAnswerProtector implements SubmissionAnswerProtector {
  private readonly encryptionKey: Buffer
  private readonly digestKey: Buffer

  constructor(masterKey: Uint8Array) {
    const key = Buffer.from(masterKey)
    if (key.byteLength !== 32) throw new SubmissionAnswerProtectionError()
    this.encryptionKey = Buffer.from(hkdfSync(
      'sha256',
      key,
      Buffer.from('sauryctf:submission-answer:v1', 'utf8'),
      Buffer.from('encryption', 'utf8'),
      32,
    ))
    this.digestKey = Buffer.from(hkdfSync(
      'sha256',
      key,
      Buffer.from('sauryctf:submission-answer:v1', 'utf8'),
      Buffer.from('digest', 'utf8'),
      32,
    ))
  }

  protect(answer: string, context: SubmissionAnswerContext): ProtectedSubmissionAnswer {
    const plaintext = Buffer.from(answer, 'utf8')
    const aad = answerAad(context)
    const nonce = randomBytes(nonceLength)
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, nonce)
    cipher.setAAD(aad)
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()
    const digest = createHmac('sha256', this.digestKey).update(plaintext).digest()
    return {
      digest,
      ciphertext: Buffer.concat([
        envelopeMagic,
        Buffer.from([envelopeVersion]),
        nonce,
        tag,
        encrypted,
      ]),
    }
  }

  reveal(ciphertext: Uint8Array, context: SubmissionAnswerContext): string {
    try {
      const envelope = Buffer.from(ciphertext)
      const headerLength = envelopeMagic.byteLength + 1 + nonceLength + tagLength
      if (envelope.byteLength < headerLength
        || !envelope.subarray(0, envelopeMagic.byteLength).equals(envelopeMagic)
        || envelope[envelopeMagic.byteLength] !== envelopeVersion) {
        throw new SubmissionAnswerProtectionError()
      }
      const nonceStart = envelopeMagic.byteLength + 1
      const tagStart = nonceStart + nonceLength
      const encryptedStart = tagStart + tagLength
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        envelope.subarray(nonceStart, tagStart),
      )
      decipher.setAAD(answerAad(context))
      decipher.setAuthTag(envelope.subarray(tagStart, encryptedStart))
      return Buffer.concat([
        decipher.update(envelope.subarray(encryptedStart)),
        decipher.final(),
      ]).toString('utf8')
    }
    catch {
      throw new SubmissionAnswerProtectionError()
    }
  }
}

function answerAad(context: SubmissionAnswerContext) {
  return Buffer.from([
    'sauryctf:submission-answer:aad:v1',
    context.contestId,
    context.challengeId,
    context.participationId,
    context.teamId,
    context.userId,
    context.requestId,
  ].join('\0'), 'utf8')
}
