import type { z } from 'zod'
import {
  challengeFlagPolicySchema,
  challengeInstancePolicySchema,
  challengeScoringPolicySchema,
} from '../../../shared/contracts/challenges'

export type ChallengePolicyField = 'flag_policy' | 'scoring_policy' | 'instance_policy'

const policySchemas: Record<ChallengePolicyField, z.ZodType> = {
  flag_policy: challengeFlagPolicySchema,
  scoring_policy: challengeScoringPolicySchema,
  instance_policy: challengeInstancePolicySchema,
}

export class ChallengePolicyValidationError extends Error {
  constructor(readonly fields: Record<string, string[]>) {
    super('Challenge policies are invalid')
    this.name = 'ChallengePolicyValidationError'
  }
}

export function challengePolicyErrors(input: Partial<Record<ChallengePolicyField, unknown>>) {
  const fields: Record<string, string[]> = {}
  for (const [field, value] of Object.entries(input) as Array<[ChallengePolicyField, unknown]>) {
    if (value === undefined) continue
    const result = policySchemas[field].safeParse(value)
    if (result.success) continue
    for (const issue of result.error.issues) {
      const suffix = issue.path.length ? issue.path.map(String).join('.') : 'type'
      const path = `${field}.${suffix}`
      fields[path] ??= []
      fields[path].push(issue.message)
    }
  }
  return fields
}

export function assertChallengePolicies(input: Partial<Record<ChallengePolicyField, unknown>>) {
  const fields = challengePolicyErrors(input)
  if (Object.keys(fields).length) throw new ChallengePolicyValidationError(fields)
}

export function firstChallengePolicyIssue(
  field: ChallengePolicyField,
  value: unknown,
): { field: string, message: string } | null {
  const fields = challengePolicyErrors({ [field]: value })
  const entry = Object.entries(fields)[0]
  if (!entry) return null
  return {
    field: entry[0].slice(field.length + 1),
    message: entry[1][0] ?? '策略配置无效',
  }
}
