import type { H3Event } from 'h3'
import { getHeader, setResponseHeader, setResponseStatus } from 'h3'
import {
  challengeTemplateResponseSchema,
  createChallengeTemplateRequestSchema,
  createChallengeTemplateVersionRequestSchema,
  type ChallengeTemplate,
  type ChallengeTemplateVersion,
} from '../../../shared/contracts/challenges'
import { entityTagForVersion, requestIdSchema, versionFromIfMatch } from '../../../shared/contracts/http'
import type { ChallengeTemplateDetail } from '../../domains/challenges/repository'
import {
  ChallengeTemplateServiceError,
  type ChallengeTemplateService,
} from '../../domains/challenges/service'
import { identityCapability } from '../../domains/identity/capabilities'
import {
  identityHttpDependencies,
  requireProtectedCapability,
  type IdentityHttpDependencies,
} from '../auth/identity-http'
import { readValidatedJsonBody } from '../http/body'
import { createApiError } from '../http/errors'

type ChallengeTemplateCommands = Pick<ChallengeTemplateService, 'create' | 'createVersion' | 'read'>

export interface ChallengeTemplateHttpDependencies {
  identity: IdentityHttpDependencies
  challengeTemplates: ChallengeTemplateCommands
}

export function challengeTemplateHttpDependencies(event: H3Event): ChallengeTemplateHttpDependencies {
  if (!event.context.services) {
    throw createApiError(503, 'platform.not_ready', '控制面数据库服务尚未就绪')
  }
  return {
    identity: identityHttpDependencies(event),
    challengeTemplates: event.context.services.challengeTemplates,
  }
}

async function manager(event: H3Event, dependencies: ChallengeTemplateHttpDependencies) {
  const context = await requireProtectedCapability(event, identityCapability.contestManage, dependencies.identity)
  return context.subject
}

async function runOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (!(error instanceof ChallengeTemplateServiceError)) throw error
    if (error.code === 'challenge.policy_invalid') {
      throw createApiError(400, 'validation.failed', '请求字段无效', error.fields)
    }
    const statusCode = {
      'challenge.asset_unavailable': 409,
      'challenge.template_not_found': 404,
      'challenge.template_slug_conflict': 409,
      'challenge.version_unchanged': 409,
      'resource.version_conflict': 409,
    }[error.code]
    throw createApiError(statusCode, error.code, error.message, error.fields)
  }
}

function projection(detail: ChallengeTemplateDetail): {
  template: ChallengeTemplate
  challenge_version: ChallengeTemplateVersion
} {
  return {
    template: {
      id: detail.template.id,
      name: detail.template.name,
      slug: detail.template.slug,
      latest_version: detail.template.latestVersion,
      version: detail.template.version,
      created_at: detail.template.createdAt.toISOString(),
      updated_at: detail.template.updatedAt.toISOString(),
    },
    challenge_version: {
      id: detail.challengeVersion.id,
      template_id: detail.challengeVersion.templateId,
      version_number: detail.challengeVersion.versionNumber,
      title: detail.challengeVersion.title,
      category: detail.challengeVersion.category,
      description: detail.challengeVersion.description,
      flag_format: detail.challengeVersion.flagFormat,
      flag_policy: detail.challengeVersion.flagPolicy,
      scoring_policy: detail.challengeVersion.scoringPolicy,
      instance_policy: detail.challengeVersion.instancePolicy,
      assets: detail.challengeVersion.assets.map(asset => ({
        id: asset.id,
        content_object_id: asset.contentObjectId,
        display_name: asset.displayName,
        sort_order: asset.sortOrder,
      })),
      hints: detail.challengeVersion.hints.map(hint => ({
        id: hint.id,
        title: hint.title,
        content: hint.content,
        release_after_seconds: hint.releaseAfterSeconds,
        sort_order: hint.sortOrder,
      })),
      created_by: detail.challengeVersion.createdBy,
      created_at: detail.challengeVersion.createdAt.toISOString(),
    },
  }
}

function respond(event: H3Event, detail: ChallengeTemplateDetail) {
  setResponseHeader(event, 'etag', entityTagForVersion(detail.template.version))
  return challengeTemplateResponseSchema.parse(projection(detail))
}

function expectedVersion(event: H3Event) {
  const version = versionFromIfMatch(getHeader(event, 'if-match'))
  if (version === null) {
    throw createApiError(428, 'resource.precondition_required', '需要有效的 If-Match 资源版本', {
      if_match: ['请提交当前资源的强 ETag，例如 "3"'],
    })
  }
  return version
}

export async function handleCreateChallengeTemplate(
  event: H3Event,
  dependencies = challengeTemplateHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  const input = await readValidatedJsonBody(event, createChallengeTemplateRequestSchema)
  const detail = await runOperation(() => dependencies.challengeTemplates.create(subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    name: input.name,
    slug: input.slug,
    title: input.title,
    category: input.category,
    description: input.description,
    flagFormat: input.flag_format,
    flagPolicy: input.flag_policy,
    scoringPolicy: input.scoring_policy,
    instancePolicy: input.instance_policy,
    assets: input.assets.map(asset => ({
      contentObjectId: asset.content_object_id,
      displayName: asset.display_name,
      sortOrder: asset.sort_order,
    })),
    hints: input.hints.map(hint => ({
      title: hint.title,
      content: hint.content,
      releaseAfterSeconds: hint.release_after_seconds,
      sortOrder: hint.sort_order,
    })),
  }))
  setResponseStatus(event, 201)
  return respond(event, detail)
}

export async function handleReadChallengeTemplate(
  event: H3Event,
  templateId: string,
  versionNumber: number | undefined,
  dependencies = challengeTemplateHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  return respond(event, await runOperation(() => dependencies.challengeTemplates.read(
    subject,
    templateId,
    versionNumber,
  )))
}

export async function handleCreateChallengeTemplateVersion(
  event: H3Event,
  templateId: string,
  dependencies = challengeTemplateHttpDependencies(event),
) {
  const subject = await manager(event, dependencies)
  const input = await readValidatedJsonBody(event, createChallengeTemplateVersionRequestSchema)
  const detail = await runOperation(() => dependencies.challengeTemplates.createVersion(subject, {
    requestId: requestIdSchema.parse(event.context.requestId),
    templateId,
    expectedVersion: expectedVersion(event),
    reason: input.reason,
    title: input.title,
    category: input.category,
    description: input.description,
    flagFormat: input.flag_format,
    flagPolicy: input.flag_policy,
    scoringPolicy: input.scoring_policy,
    instancePolicy: input.instance_policy,
    assets: input.assets?.map(asset => ({
      contentObjectId: asset.content_object_id,
      displayName: asset.display_name,
      sortOrder: asset.sort_order,
    })),
    hints: input.hints?.map(hint => ({
      title: hint.title,
      content: hint.content,
      releaseAfterSeconds: hint.release_after_seconds,
      sortOrder: hint.sort_order,
    })),
  }))
  setResponseStatus(event, 201)
  return respond(event, detail)
}
