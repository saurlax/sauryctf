export interface HumanVerificationInput {
  token?: string
  remoteIp?: string
  action: string
}

export interface HumanVerificationProvider {
  readonly required: boolean
  verify(input: HumanVerificationInput): Promise<boolean>
}

export class DisabledHumanVerificationProvider implements HumanVerificationProvider {
  readonly required = false
  async verify(): Promise<boolean> { return true }
}

export class HumanVerificationError extends Error {
  constructor(readonly code: 'security.human_verification_required' | 'security.human_verification_failed') {
    super(code === 'security.human_verification_required' ? '请完成人机验证' : '人机验证失败')
    this.name = 'HumanVerificationError'
  }
}

export async function requireHumanVerification(
  provider: HumanVerificationProvider,
  input: HumanVerificationInput,
): Promise<void> {
  if (!provider.required) return
  if (!input.token) throw new HumanVerificationError('security.human_verification_required')
  if (!await provider.verify(input)) throw new HumanVerificationError('security.human_verification_failed')
}
