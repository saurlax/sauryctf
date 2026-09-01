import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { stringify } from 'yaml'
import {
  apiErrorSchema,
  pageInfoSchema,
  paginationRequestSchema,
  resourceVersionSchema,
} from '../shared/contracts/http'
import {
  adminUserListRequestSchema,
  adminUserListResponseSchema,
  changeUserStatusRequestSchema,
  changeGlobalRoleRequestSchema,
  changeEmailRequestSchema,
  changePasswordRequestSchema,
  emailVerificationConfirmRequestSchema,
  emailChangedSchema,
  emailVerifiedSchema,
  globalRoleChangedSchema,
  identityLogoutResponseSchema,
  identitySessionResponseSchema,
  loginIdentityRequestSchema,
  passwordChangedSchema,
  passwordResetAcceptedSchema,
  passwordResetConfirmRequestSchema,
  passwordResetRequestSchema,
  registerIdentityRequestSchema,
  userStatusChangedSchema,
} from '../shared/contracts/identity'
import { csrfTokenResponseSchema } from '../shared/contracts/request-security'
import {
  adminTeamCorrectionRequestSchema,
  createTeamRequestSchema,
  inviteRotatedResponseSchema,
  joinTeamRequestSchema,
  memberRemovedResponseSchema,
  teamLeftResponseSchema,
  teamMutationResponseSchema,
  teamResponseSchema,
  transferCaptainRequestSchema,
} from '../shared/contracts/teams'
import {
  adminParticipationListRequestSchema,
  adminParticipationListResponseSchema,
  assignParticipationDivisionRequestSchema,
  currentParticipationResponseSchema,
  participationMutationResponseSchema,
  registerParticipationRequestSchema,
  reviewParticipationRequestSchema,
} from '../shared/contracts/participations'
import {
  contestLifecycleRequestSchema,
  contestResponseSchema,
  createContestDraftRequestSchema,
  updateContestDraftRequestSchema,
} from '../shared/contracts/contests'

function openApiSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>
  delete jsonSchema.$schema
  return jsonSchema
}

const liveResponseSchema = z.strictObject({
  status: z.literal('ok'),
  component: z.literal('control-plane'),
})

const readyResponseSchema = z.strictObject({
  status: z.literal('ready'),
  component: z.literal('control-plane'),
})

function jsonRequestBody(schema: z.ZodType) {
  return {
    required: true,
    content: {
      'application/json': { schema: openApiSchema(schema) },
    },
  }
}

function jsonResponse(description: string, schema: z.ZodType) {
  return {
    description,
    content: {
      'application/json': { schema: openApiSchema(schema) },
    },
  }
}

const errorResponse = {
  description: 'Stable API error',
  content: {
    'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
  },
}

const originParameter = {
  name: 'Origin',
  in: 'header',
  required: true,
  schema: { type: 'string', format: 'uri' },
  description: 'Must match the configured public control-plane origin.',
}

const csrfParameter = {
  name: 'X-CSRF-Token',
  in: 'header',
  required: true,
  schema: { type: 'string', minLength: 43, maxLength: 43 },
  description: 'Double-submit proof matching the sauryctf-csrf cookie.',
}

const ifMatchParameter = {
  name: 'If-Match',
  in: 'header',
  required: true,
  schema: { type: 'string', pattern: '^"[1-9][0-9]*"$' },
  description: 'Strong ETag containing the current resource version.',
}

const document = {
  openapi: '3.1.0',
  info: {
    title: 'SauryCTF Control Plane API',
    version: '1.0.0-alpha.1',
    description: 'Nuxt/Nitro Jeopardy control-plane API. Generated from shared Zod contracts.',
  },
  paths: {
    '/api/health/live': {
      get: {
        operationId: 'getControlPlaneLiveness',
        tags: ['Health'],
        responses: {
          200: {
            description: 'Nitro process is alive',
            content: {
              'application/json': { schema: openApiSchema(liveResponseSchema) },
            },
          },
        },
      },
    },
    '/api/health/ready': {
      get: {
        operationId: 'getControlPlaneReadiness',
        tags: ['Health'],
        responses: {
          200: {
            description: 'Control plane has required deployment configuration',
            content: {
              'application/json': { schema: openApiSchema(readyResponseSchema) },
            },
          },
          503: {
            description: 'Control plane is not ready',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/api/auth/register': {
      post: {
        operationId: 'registerIdentity',
        tags: ['Identity'],
        parameters: [originParameter],
        requestBody: jsonRequestBody(registerIdentityRequestSchema),
        responses: {
          201: jsonResponse('Identity registered and browser session created', identitySessionResponseSchema),
          400: errorResponse,
          403: errorResponse,
          409: errorResponse,
          429: errorResponse,
        },
      },
    },
    '/api/auth/login': {
      post: {
        operationId: 'loginIdentity',
        tags: ['Identity'],
        parameters: [originParameter],
        requestBody: jsonRequestBody(loginIdentityRequestSchema),
        responses: {
          200: jsonResponse('Credentials accepted and browser session created', identitySessionResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          429: errorResponse,
        },
      },
    },
    '/api/auth/me': {
      get: {
        operationId: 'getCurrentIdentity',
        tags: ['Identity'],
        security: [{ cookieSession: [] }],
        responses: {
          200: jsonResponse('Current authoritative identity projection', identitySessionResponseSchema),
          401: errorResponse,
        },
      },
    },
    '/api/auth/logout': {
      post: {
        operationId: 'logoutIdentity',
        tags: ['Identity'],
        security: [{ cookieSession: [] }],
        parameters: [originParameter, csrfParameter],
        responses: {
          200: jsonResponse('Browser session cleared', identityLogoutResponseSchema),
          403: errorResponse,
        },
      },
    },
    '/api/auth/password/change': {
      post: {
        operationId: 'changePassword',
        tags: ['Identity'],
        security: [{ cookieSession: [] }],
        parameters: [originParameter, csrfParameter],
        requestBody: jsonRequestBody(changePasswordRequestSchema),
        responses: {
          200: jsonResponse('Password changed and current session refreshed', passwordChangedSchema),
          400: errorResponse,
          401: errorResponse,
          409: errorResponse,
        },
      },
    },
    '/api/auth/password/reset/request': {
      post: {
        operationId: 'requestPasswordReset',
        tags: ['Identity'],
        parameters: [originParameter],
        requestBody: jsonRequestBody(passwordResetRequestSchema),
        responses: {
          202: jsonResponse('Reset request accepted without account disclosure', passwordResetAcceptedSchema),
          400: errorResponse,
          403: errorResponse,
          429: errorResponse,
        },
      },
    },
    '/api/auth/password/reset/confirm': {
      post: {
        operationId: 'confirmPasswordReset',
        tags: ['Identity'],
        parameters: [originParameter],
        requestBody: jsonRequestBody(passwordResetConfirmRequestSchema),
        responses: {
          200: jsonResponse('Password reset and any browser session cleared', passwordChangedSchema),
          400: errorResponse,
          429: errorResponse,
        },
      },
    },
    '/api/auth/email/verification/request': {
      post: {
        operationId: 'requestEmailVerification',
        tags: ['Identity'],
        security: [{ cookieSession: [] }],
        parameters: [originParameter, csrfParameter],
        responses: {
          202: jsonResponse('Verification request accepted', passwordResetAcceptedSchema),
          401: errorResponse,
          429: errorResponse,
        },
      },
    },
    '/api/auth/email/change': {
      post: {
        operationId: 'changeEmail',
        tags: ['Identity'],
        security: [{ cookieSession: [] }],
        parameters: [originParameter, csrfParameter],
        requestBody: jsonRequestBody(changeEmailRequestSchema),
        responses: {
          200: jsonResponse('Email changed, verification reset, and current session refreshed', emailChangedSchema),
          400: errorResponse,
          401: errorResponse,
          409: errorResponse,
          429: errorResponse,
        },
      },
    },
    '/api/auth/email/verification/confirm': {
      post: {
        operationId: 'confirmEmailVerification',
        tags: ['Identity'],
        parameters: [originParameter],
        requestBody: jsonRequestBody(emailVerificationConfirmRequestSchema),
        responses: {
          200: jsonResponse('Email verified', emailVerifiedSchema),
          400: errorResponse,
          429: errorResponse,
        },
      },
    },
    '/api/auth/csrf': {
      get: {
        operationId: 'getCsrfToken',
        tags: ['Identity'],
        responses: {
          200: jsonResponse('Double-submit CSRF token and matching cookie', csrfTokenResponseSchema),
        },
      },
    },
    '/api/admin/users/{userId}/role': {
      patch: {
        operationId: 'changeUserGlobalRole',
        tags: ['Administration', 'Identity'],
        security: [{ cookieSession: [] }],
        parameters: [
          {
            name: 'userId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          originParameter,
          csrfParameter,
        ],
        requestBody: jsonRequestBody(changeGlobalRoleRequestSchema),
        responses: {
          200: jsonResponse('Global role changed and target sessions invalidated', globalRoleChangedSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    '/api/admin/users': {
      get: {
        operationId: 'listManagedIdentities',
        tags: ['Administration', 'Identity'],
        security: [{ cookieSession: [] }],
        parameters: [
          {
            name: 'cursor',
            in: 'query',
            required: false,
            schema: openApiSchema(adminUserListRequestSchema.shape.cursor),
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: openApiSchema(adminUserListRequestSchema.shape.limit),
          },
        ],
        responses: {
          200: jsonResponse('Cursor-paginated user management projection', adminUserListResponseSchema),
          401: errorResponse,
          403: errorResponse,
        },
      },
    },
    '/api/admin/users/{userId}/status': {
      patch: {
        operationId: 'changeUserStatus',
        tags: ['Administration', 'Identity'],
        security: [{ cookieSession: [] }],
        parameters: [
          {
            name: 'userId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          originParameter,
          csrfParameter,
        ],
        requestBody: jsonRequestBody(changeUserStatusRequestSchema),
        responses: {
          200: jsonResponse('User status changed and target sessions invalidated', userStatusChangedSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
    '/api/teams': {
      get: { operationId: 'getCurrentTeam', tags: ['Teams'], security: [{ cookieSession: [] }], responses: { 200: jsonResponse('Current team or null', teamResponseSchema), 401: errorResponse, 403: errorResponse } },
      post: { operationId: 'createTeam', tags: ['Teams'], security: [{ cookieSession: [] }], parameters: [originParameter, csrfParameter], requestBody: jsonRequestBody(createTeamRequestSchema), responses: { 201: jsonResponse('Team created', teamMutationResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 409: errorResponse } },
    },
    '/api/teams/join': { post: { operationId: 'joinTeam', tags: ['Teams'], security: [{ cookieSession: [] }], parameters: [originParameter, csrfParameter], requestBody: jsonRequestBody(joinTeamRequestSchema), responses: { 200: jsonResponse('Joined team', teamMutationResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 409: errorResponse } } },
    '/api/teams/leave': { post: { operationId: 'leaveTeam', tags: ['Teams'], security: [{ cookieSession: [] }], parameters: [originParameter, csrfParameter], responses: { 200: jsonResponse('Left team', teamLeftResponseSchema), 401: errorResponse, 403: errorResponse, 404: errorResponse } } },
    '/api/teams/invite/rotate': { post: { operationId: 'rotateTeamInvite', tags: ['Teams'], security: [{ cookieSession: [] }], parameters: [originParameter, csrfParameter], responses: { 200: jsonResponse('Invite rotated', inviteRotatedResponseSchema), 401: errorResponse, 403: errorResponse, 404: errorResponse } } },
    '/api/teams/captain/transfer': { post: { operationId: 'transferTeamCaptain', tags: ['Teams'], security: [{ cookieSession: [] }], parameters: [originParameter, csrfParameter], requestBody: jsonRequestBody(transferCaptainRequestSchema), responses: { 200: jsonResponse('Captain transferred', teamMutationResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse } } },
    '/api/teams/members/{userId}': { delete: { operationId: 'removeTeamMember', tags: ['Teams'], security: [{ cookieSession: [] }], parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], responses: { 200: jsonResponse('Member removed', memberRemovedResponseSchema), 401: errorResponse, 403: errorResponse, 404: errorResponse } } },
    '/api/admin/teams/{teamId}/corrections': { post: { operationId: 'correctTeamMembership', tags: ['Administration', 'Teams'], security: [{ cookieSession: [] }], parameters: [{ name: 'teamId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], requestBody: jsonRequestBody(adminTeamCorrectionRequestSchema), responses: { 200: jsonResponse('Team membership corrected with audit evidence', teamMutationResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse } } },
    '/api/admin/contests': { post: { operationId: 'createContestDraft', tags: ['Administration', 'Contests'], security: [{ cookieSession: [] }], parameters: [originParameter, csrfParameter], requestBody: jsonRequestBody(createContestDraftRequestSchema), responses: { 201: jsonResponse('Contest draft created', contestResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 409: errorResponse } } },
    '/api/admin/contests/{contestId}': {
      get: { operationId: 'getManagedContest', tags: ['Administration', 'Contests'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: jsonResponse('Managed contest projection', contestResponseSchema), 401: errorResponse, 403: errorResponse, 404: errorResponse } },
      patch: { operationId: 'updateContestDraft', tags: ['Administration', 'Contests'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter, ifMatchParameter], requestBody: jsonRequestBody(updateContestDraftRequestSchema), responses: { 200: jsonResponse('Contest draft configuration updated', contestResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse, 428: errorResponse } },
    },
    '/api/admin/contests/{contestId}/publish': { post: { operationId: 'publishContest', tags: ['Administration', 'Contests'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], requestBody: jsonRequestBody(contestLifecycleRequestSchema), responses: { 200: jsonResponse('Contest published', contestResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse } } },
    '/api/admin/contests/{contestId}/archive': { post: { operationId: 'archiveContest', tags: ['Administration', 'Contests'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], requestBody: jsonRequestBody(contestLifecycleRequestSchema), responses: { 200: jsonResponse('Ended contest archived', contestResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse } } },
    '/api/contests/{contestId}': { get: { operationId: 'getPublicContest', tags: ['Contests'], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: jsonResponse('Public published or archived contest projection', contestResponseSchema), 404: errorResponse } } },
    '/api/contests/{contestId}/participation': {
      get: { operationId: 'getCurrentParticipation', tags: ['Contests', 'Participations'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: jsonResponse('Current team participation projection', currentParticipationResponseSchema), 401: errorResponse, 404: errorResponse } },
      post: { operationId: 'registerParticipation', tags: ['Contests', 'Participations'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], requestBody: jsonRequestBody(registerParticipationRequestSchema), responses: { 201: jsonResponse('Team registration created', participationMutationResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse } },
    },
    '/api/contests/{contestId}/participation/withdraw': { post: { operationId: 'withdrawParticipation', tags: ['Contests', 'Participations'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], responses: { 200: jsonResponse('Team registration withdrawn', participationMutationResponseSchema), 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse } } },
    '/api/admin/contests/{contestId}/participations': { get: { operationId: 'listParticipations', tags: ['Administration', 'Contests', 'Participations'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'cursor', in: 'query', required: false, schema: openApiSchema(adminParticipationListRequestSchema.shape.cursor) }, { name: 'limit', in: 'query', required: false, schema: openApiSchema(adminParticipationListRequestSchema.shape.limit) }, { name: 'status', in: 'query', required: false, schema: openApiSchema(adminParticipationListRequestSchema.shape.status) }], responses: { 200: jsonResponse('Cursor-paginated participation management projection', adminParticipationListResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse } } },
    '/api/admin/contests/{contestId}/participations/{participationId}/review': { post: { operationId: 'reviewParticipation', tags: ['Administration', 'Contests', 'Participations'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'participationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], requestBody: jsonRequestBody(reviewParticipationRequestSchema), responses: { 200: jsonResponse('Participation reviewed with audit evidence', participationMutationResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse } } },
    '/api/admin/contests/{contestId}/participations/{participationId}/division': { patch: { operationId: 'assignParticipationDivision', tags: ['Administration', 'Contests', 'Participations'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'participationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], requestBody: jsonRequestBody(assignParticipationDivisionRequestSchema), responses: { 200: jsonResponse('Participation division assigned with audit evidence', participationMutationResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse } } },
  },
  components: {
    securitySchemes: {
      cookieSession: {
        type: 'apiKey',
        in: 'cookie',
        name: 'sauryctf-session',
      },
    },
    schemas: {
      ErrorResponse: openApiSchema(apiErrorSchema),
      PageInfo: openApiSchema(pageInfoSchema),
      PaginationRequest: openApiSchema(paginationRequestSchema),
      ResourceVersion: openApiSchema(resourceVersionSchema),
    },
  },
}

const outputPath = resolve(import.meta.dirname, '../../../api/openapi.yaml')
writeFileSync(outputPath, stringify(document, { lineWidth: 0 }), 'utf8')
console.log(`Generated ${outputPath}`)
