import { describe, expect, it } from 'vitest'
import {
  assertImplicitJeopardyContestPayload,
  ContestModeUnsupportedError,
} from './admission'

describe('Jeopardy-only contest admission', () => {
  it.each(['awd', 'mixed', 'unknown', 'jeopardy'])(
    'rejects explicit API mode %s because the first-release contract is implicit',
    (mode) => {
      expect(() => assertImplicitJeopardyContestPayload({ mode }, 'api')).toThrowError(
        expect.objectContaining<Partial<ContestModeUnsupportedError>>({
          field: 'mode',
        }),
      )
    },
  )

  it.each([
    [{ contest: { mode: 'awd' } }, 'contest.mode'],
    [{ contest_mode: 'unknown' }, 'contest_mode'],
    [{ contest: { competition_mode: 'mixed' } }, 'contest.competition_mode'],
    [{ services: [] }, 'services'],
    [{ contest: { ticks: [] } }, 'contest.ticks'],
    [{ vpn: {} }, 'vpn'],
    [{ checkers: [] }, 'checkers'],
    [{ contest: { terminal: {} } }, 'contest.terminal'],
  ])('rejects unsupported import discriminator at %s', (manifest, field) => {
    expect(() => assertImplicitJeopardyContestPayload(manifest, 'import')).toThrowError(
      expect.objectContaining<Partial<ContestModeUnsupportedError>>({ field }),
    )
  })

  it('accepts a mode-free Jeopardy API body and import envelope', () => {
    expect(() => assertImplicitJeopardyContestPayload({ title: 'Contest' }, 'api')).not.toThrow()
    expect(() => assertImplicitJeopardyContestPayload({
      package_version: 'sauryctf.jeopardy.v1',
      contest: { title: 'Contest' },
      challenges: [],
    }, 'import')).not.toThrow()
  })
})
