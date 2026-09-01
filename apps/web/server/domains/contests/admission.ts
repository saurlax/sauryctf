type ContestAdmissionSource = 'api' | 'import'

export class ContestModeUnsupportedError extends Error {
  constructor(readonly field: string) {
    super('首期只接受隐式 Jeopardy 比赛，不能声明其他或混合赛制')
    this.name = 'ContestModeUnsupportedError'
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function rejectModeKeys(value: Record<string, unknown>, prefix: string) {
  for (const key of ['mode', 'contest_mode', 'competition_mode']) {
    if (Object.hasOwn(value, key)) throw new ContestModeUnsupportedError(`${prefix}${key}`)
  }
}

export function assertImplicitJeopardyContestPayload(
  payload: unknown,
  source: ContestAdmissionSource,
) {
  const root = record(payload)
  if (!root) return
  rejectModeKeys(root, '')

  if (source !== 'import') return
  const contest = record(root.contest)
  if (contest) rejectModeKeys(contest, 'contest.')

  for (const key of ['services', 'ticks', 'vpn', 'checkers', 'terminal']) {
    if (Object.hasOwn(root, key)) throw new ContestModeUnsupportedError(key)
    if (contest && Object.hasOwn(contest, key)) {
      throw new ContestModeUnsupportedError(`contest.${key}`)
    }
  }
}
