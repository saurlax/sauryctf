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
  contestPublicationCheckResponseSchema,
  contestResponseSchema,
  createContestDraftRequestSchema,
  updateContestDraftRequestSchema,
} from '../shared/contracts/contests'
import {
  announcementListRequestSchema,
  announcementListResponseSchema,
  announcementResponseSchema,
  createAnnouncementRequestSchema,
  updateAnnouncementRequestSchema,
  withdrawAnnouncementRequestSchema,
} from '../shared/contracts/announcements'
import {
  publicTimelineListRequestSchema,
  publicTimelineListResponseSchema,
} from '../shared/contracts/timeline'
import {
  challengeTemplateResponseSchema,
  contestChallengeResponseSchema,
  createChallengeTemplateRequestSchema,
  createChallengeTemplateVersionRequestSchema,
  mountContestChallengeRequestSchema,
  playerContestChallengeListResponseSchema,
  playerContestChallengeResponseSchema,
  reviseContestChallengeRequestSchema,
} from '../shared/contracts/challenges'
import {
  cheatClueListRequestSchema,
  cheatClueListResponseSchema,
  managedSubmissionListRequestSchema,
  managedSubmissionListResponseSchema,
  recordScoreAdjustmentRequestSchema,
  recordScoreAdjustmentResponseSchema,
  reviewCheatClueRequestSchema,
  reviewCheatClueResponseSchema,
  submitFlagRequestSchema,
  submitFlagResponseSchema,
} from '../shared/contracts/submissions'
import {
  scoreboardQuerySchema,
  scoreboardResponseSchema,
} from '../shared/contracts/scoreboards'
import {
  publicRealtimeEventSchema,
  publicRealtimeResetSchema,
} from '../shared/contracts/public-realtime'
import {
  commitContentUploadRequestSchema,
  contentDownloadResponseSchema,
  contentObjectResponseSchema,
} from '../shared/contracts/content'
import {
  correctWriteupRequestSchema,
  managedWriteupListRequestSchema,
  managedWriteupListResponseSchema,
  ownWriteupResponseSchema,
  reviewWriteupRequestSchema,
  saveWriteupRequestSchema,
  writeupResponseSchema,
} from '../shared/contracts/writeups'
import {
  contestPackageExportResponseSchema,
  contestPackageImportResponseSchema,
  createContestPackageExportRequestSchema,
  importContestPackageRequestSchema,
} from '../shared/contracts/contest-packages'

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

const writeupIfMatchParameter = {
  name: 'If-Match',
  in: 'header',
  required: true,
  schema: { type: 'string', pattern: '^"(?:0|[1-9][0-9]*)"$' },
  description: 'Strong ETag containing the current Writeup aggregate version; use "0" when no aggregate exists.',
}

const idempotencyKeyParameter = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  schema: { type: 'string', minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' },
  description: 'Stable caller-generated key for one logical package operation.',
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
    '/api/admin/challenge-templates': { post: { operationId: 'createChallengeTemplate', tags: ['Administration', 'Challenges'], security: [{ cookieSession: [] }], parameters: [originParameter, csrfParameter], requestBody: jsonRequestBody(createChallengeTemplateRequestSchema), responses: { 201: jsonResponse('Challenge template and initial immutable version created', challengeTemplateResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 409: errorResponse } } },
    '/api/admin/challenge-templates/{templateId}': { get: { operationId: 'getChallengeTemplate', tags: ['Administration', 'Challenges'], security: [{ cookieSession: [] }], parameters: [{ name: 'templateId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: jsonResponse('Challenge template with latest immutable version', challengeTemplateResponseSchema), 401: errorResponse, 403: errorResponse, 404: errorResponse } } },
    '/api/admin/challenge-templates/{templateId}/versions': { post: { operationId: 'createChallengeTemplateVersion', tags: ['Administration', 'Challenges'], security: [{ cookieSession: [] }], parameters: [{ name: 'templateId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter, ifMatchParameter], requestBody: jsonRequestBody(createChallengeTemplateVersionRequestSchema), responses: { 201: jsonResponse('New immutable challenge template version created', challengeTemplateResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse, 428: errorResponse } } },
    '/api/admin/challenge-templates/{templateId}/versions/{versionNumber}': { get: { operationId: 'getChallengeTemplateVersion', tags: ['Administration', 'Challenges'], security: [{ cookieSession: [] }], parameters: [{ name: 'templateId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'versionNumber', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }], responses: { 200: jsonResponse('Historical immutable challenge template version', challengeTemplateResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse } } },
    '/api/admin/contests/{contestId}/challenges': { post: { operationId: 'mountContestChallenge', tags: ['Administration', 'Challenges'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], requestBody: jsonRequestBody(mountContestChallengeRequestSchema), responses: { 201: jsonResponse('Independent contest challenge snapshot mounted from one immutable template version', contestChallengeResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse } } },
    '/api/admin/contests/{contestId}/challenges/{challengeId}': { get: { operationId: 'getManagedContestChallenge', tags: ['Administration', 'Challenges'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'challengeId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: jsonResponse('Managed contest challenge snapshot', contestChallengeResponseSchema), 401: errorResponse, 403: errorResponse, 404: errorResponse } } },
    '/api/admin/contests/{contestId}/challenges/{challengeId}/revisions': { post: { operationId: 'reviseContestChallengeSnapshot', tags: ['Administration', 'Challenges'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'challengeId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter, ifMatchParameter], requestBody: jsonRequestBody(reviseContestChallengeRequestSchema), responses: { 200: jsonResponse('Published contest challenge snapshot explicitly revised with a new revision and resource version', contestChallengeResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse, 428: errorResponse } } },
    '/api/admin/contests/{contestId}/submissions': { get: { operationId: 'listManagedContestSubmissions', tags: ['Administration', 'Submissions'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'cursor', in: 'query', required: false, schema: openApiSchema(managedSubmissionListRequestSchema.shape.cursor) }, { name: 'limit', in: 'query', required: false, schema: openApiSchema(managedSubmissionListRequestSchema.shape.limit) }], responses: { 200: jsonResponse('Paginated immutable submission facts with answers fixed-mask redacted', managedSubmissionListResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse } } },
    '/api/admin/contests/{contestId}/score-adjustments': { post: { operationId: 'recordContestScoreAdjustment', tags: ['Administration', 'Submissions', 'Scoreboards'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], requestBody: jsonRequestBody(recordScoreAdjustmentRequestSchema), responses: { 200: jsonResponse('Explicit score adjustment recorded with audit and scoreboard version evidence', recordScoreAdjustmentResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse } } },
    '/api/admin/contests/{contestId}/cheat-clues': { get: { operationId: 'listContestCheatClues', tags: ['Administration', 'Submissions'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'cursor', in: 'query', required: false, schema: openApiSchema(cheatClueListRequestSchema.shape.cursor) }, { name: 'limit', in: 'query', required: false, schema: openApiSchema(cheatClueListRequestSchema.shape.limit) }, { name: 'status', in: 'query', required: false, schema: openApiSchema(cheatClueListRequestSchema.shape.status) }], responses: { 200: jsonResponse('Paginated reviewable anti-cheat evidence without plaintext answers', cheatClueListResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse } } },
    '/api/admin/contests/{contestId}/cheat-clues/{clueId}': { patch: { operationId: 'reviewContestCheatClue', tags: ['Administration', 'Submissions'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'clueId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], requestBody: jsonRequestBody(reviewCheatClueRequestSchema), responses: { 200: jsonResponse('Anti-cheat evidence classified by an authorized human reviewer without automatic punishment', reviewCheatClueResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse } } },
    '/api/admin/contests/{contestId}': {
      get: { operationId: 'getManagedContest', tags: ['Administration', 'Contests'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: jsonResponse('Managed contest projection', contestResponseSchema), 401: errorResponse, 403: errorResponse, 404: errorResponse } },
      patch: { operationId: 'updateContestDraft', tags: ['Administration', 'Contests'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter, ifMatchParameter], requestBody: jsonRequestBody(updateContestDraftRequestSchema), responses: { 200: jsonResponse('Contest draft configuration updated', contestResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse, 428: errorResponse } },
    },
    '/api/admin/contests/{contestId}/publish': { post: { operationId: 'publishContest', tags: ['Administration', 'Contests'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], requestBody: jsonRequestBody(contestLifecycleRequestSchema), responses: { 200: jsonResponse('Contest published', contestResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse } } },
    '/api/admin/contests/{contestId}/publication-check': { get: { operationId: 'checkContestPublication', tags: ['Administration', 'Contests'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: jsonResponse('Contest publication preflight result', contestPublicationCheckResponseSchema), 401: errorResponse, 403: errorResponse, 404: errorResponse } } },
    '/api/admin/contests/{contestId}/archive': { post: { operationId: 'archiveContest', tags: ['Administration', 'Contests'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], requestBody: jsonRequestBody(contestLifecycleRequestSchema), responses: { 200: jsonResponse('Ended contest archived', contestResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse } } },
    '/api/admin/contests/{contestId}/announcements': {
      get: {
        operationId: 'listManagedAnnouncements',
        tags: ['Administration', 'Contests', 'Announcements'],
        security: [{ cookieSession: [] }],
        parameters: [
          { name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'cursor', in: 'query', required: false, schema: openApiSchema(announcementListRequestSchema.shape.cursor) },
          { name: 'limit', in: 'query', required: false, schema: openApiSchema(announcementListRequestSchema.shape.limit) },
        ],
        responses: {
          200: jsonResponse('Cursor-paginated announcement management projection', announcementListResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
      post: {
        operationId: 'createAnnouncement',
        tags: ['Administration', 'Contests', 'Announcements'],
        security: [{ cookieSession: [] }],
        parameters: [
          { name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          originParameter,
          csrfParameter,
        ],
        requestBody: jsonRequestBody(createAnnouncementRequestSchema),
        responses: {
          201: jsonResponse('Announcement created with a scheduled publication event', announcementResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
    '/api/admin/contests/{contestId}/announcements/{announcementId}': {
      patch: {
        operationId: 'updateAnnouncement',
        tags: ['Administration', 'Contests', 'Announcements'],
        security: [{ cookieSession: [] }],
        parameters: [
          { name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'announcementId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          originParameter,
          csrfParameter,
          ifMatchParameter,
        ],
        requestBody: jsonRequestBody(updateAnnouncementRequestSchema),
        responses: {
          200: jsonResponse('Announcement updated with optimistic concurrency', announcementResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          428: errorResponse,
        },
      },
    },
    '/api/admin/contests/{contestId}/announcements/{announcementId}/withdraw': {
      post: {
        operationId: 'withdrawAnnouncement',
        tags: ['Administration', 'Contests', 'Announcements'],
        security: [{ cookieSession: [] }],
        parameters: [
          { name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'announcementId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          originParameter,
          csrfParameter,
          ifMatchParameter,
        ],
        requestBody: jsonRequestBody(withdrawAnnouncementRequestSchema),
        responses: {
          200: jsonResponse('Announcement withdrawn and hidden from public reads', announcementResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          428: errorResponse,
        },
      },
    },
    '/api/contests/{contestId}': { get: { operationId: 'getPublicContest', tags: ['Contests'], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: jsonResponse('Public published or archived contest projection', contestResponseSchema), 404: errorResponse } } },
    '/api/contests/{contestId}/challenges': { get: { operationId: 'listPlayerContestChallenges', tags: ['Contests', 'Challenges'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: jsonResponse('Player-safe contest challenge projections filtered by participation and release state', playerContestChallengeListResponseSchema), 401: errorResponse, 403: errorResponse, 404: errorResponse } } },
    '/api/contests/{contestId}/challenges/{challengeId}': { get: { operationId: 'getPlayerContestChallenge', tags: ['Contests', 'Challenges'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'challengeId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: jsonResponse('Player-safe contest challenge projection without Flag verification material', playerContestChallengeResponseSchema), 401: errorResponse, 403: errorResponse, 404: errorResponse } } },
    '/api/contests/{contestId}/challenges/{challengeId}/submissions': { post: { operationId: 'submitContestChallengeFlag', tags: ['Contests', 'Challenges', 'Submissions'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'challengeId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], requestBody: jsonRequestBody(submitFlagRequestSchema), responses: { 200: jsonResponse('Synchronous redacted Flag verdict after authoritative eligibility and layered rate-limit checks', submitFlagResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse, 429: errorResponse, 503: errorResponse } } },
    '/api/contests/{contestId}/announcements': {
      get: {
        operationId: 'listPublicAnnouncements',
        tags: ['Contests', 'Announcements'],
        parameters: [
          { name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'cursor', in: 'query', required: false, schema: openApiSchema(announcementListRequestSchema.shape.cursor) },
          { name: 'limit', in: 'query', required: false, schema: openApiSchema(announcementListRequestSchema.shape.limit) },
        ],
        responses: {
          200: jsonResponse('Published, non-withdrawn announcements for a public contest', announcementListResponseSchema),
          400: errorResponse,
          404: errorResponse,
        },
      },
    },
    '/api/contests/{contestId}/timeline': {
      get: {
        operationId: 'listPublicContestTimeline',
        tags: ['Contests', 'Timeline'],
        parameters: [
          { name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'cursor', in: 'query', required: false, schema: openApiSchema(publicTimelineListRequestSchema.shape.cursor) },
          { name: 'limit', in: 'query', required: false, schema: openApiSchema(publicTimelineListRequestSchema.shape.limit) },
        ],
        responses: {
          200: jsonResponse('Selected public contest events with stable cursor pagination', publicTimelineListResponseSchema),
          400: errorResponse,
          404: errorResponse,
        },
      },
    },
    '/api/contests/{contestId}/scoreboard': {
      get: {
        operationId: 'getPublicContestScoreboard',
        tags: ['Contests', 'Scoreboards'],
        parameters: [
          { name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'division_id', in: 'query', required: false, schema: openApiSchema(scoreboardQuerySchema.shape.division_id) },
        ],
        responses: {
          200: jsonResponse('Public live, frozen, or settled deterministic scoreboard projection', scoreboardResponseSchema),
          400: errorResponse,
          404: errorResponse,
        },
      },
    },
    '/api/contests/{contestId}/events': {
      get: {
        operationId: 'streamPublicContestEvents',
        tags: ['Contests', 'Scoreboards'],
        parameters: [
          { name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          {
            name: 'Last-Event-ID',
            in: 'header',
            required: false,
            schema: { type: 'string', format: 'uuid' },
            description: 'Stable event id used to replay events still present in the recovery window.',
          },
        ],
        responses: {
          200: {
            description: 'Contest-scoped SSE refresh signals. A reset event requires a full read-model refresh.',
            content: {
              'text/event-stream': {
                schema: {
                  oneOf: [
                    openApiSchema(publicRealtimeEventSchema),
                    openApiSchema(publicRealtimeResetSchema),
                  ],
                },
              },
            },
          },
          400: errorResponse,
          404: errorResponse,
        },
      },
    },
    '/api/admin/contests/{contestId}/scoreboard': {
      get: {
        operationId: 'getInternalContestScoreboard',
        tags: ['Administration', 'Contests', 'Scoreboards'],
        security: [{ cookieSession: [] }],
        parameters: [
          { name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'division_id', in: 'query', required: false, schema: openApiSchema(scoreboardQuerySchema.shape.division_id) },
        ],
        responses: {
          200: jsonResponse('Organizer and administrator live internal scoreboard projection', scoreboardResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    '/api/contests/{contestId}/participation': {
      get: { operationId: 'getCurrentParticipation', tags: ['Contests', 'Participations'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: jsonResponse('Current team participation projection', currentParticipationResponseSchema), 401: errorResponse, 404: errorResponse } },
      post: { operationId: 'registerParticipation', tags: ['Contests', 'Participations'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], requestBody: jsonRequestBody(registerParticipationRequestSchema), responses: { 201: jsonResponse('Team registration created', participationMutationResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse } },
    },
    '/api/contests/{contestId}/participation/withdraw': { post: { operationId: 'withdrawParticipation', tags: ['Contests', 'Participations'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], responses: { 200: jsonResponse('Team registration withdrawn', participationMutationResponseSchema), 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse } } },
    '/api/admin/contests/{contestId}/participations': { get: { operationId: 'listParticipations', tags: ['Administration', 'Contests', 'Participations'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'cursor', in: 'query', required: false, schema: openApiSchema(adminParticipationListRequestSchema.shape.cursor) }, { name: 'limit', in: 'query', required: false, schema: openApiSchema(adminParticipationListRequestSchema.shape.limit) }, { name: 'status', in: 'query', required: false, schema: openApiSchema(adminParticipationListRequestSchema.shape.status) }], responses: { 200: jsonResponse('Cursor-paginated participation management projection', adminParticipationListResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse } } },
    '/api/admin/contests/{contestId}/participations/{participationId}/review': { post: { operationId: 'reviewParticipation', tags: ['Administration', 'Contests', 'Participations'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'participationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], requestBody: jsonRequestBody(reviewParticipationRequestSchema), responses: { 200: jsonResponse('Participation reviewed with audit evidence', participationMutationResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse } } },
    '/api/admin/contests/{contestId}/participations/{participationId}/division': { patch: { operationId: 'assignParticipationDivision', tags: ['Administration', 'Contests', 'Participations'], security: [{ cookieSession: [] }], parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'participationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, originParameter, csrfParameter], requestBody: jsonRequestBody(assignParticipationDivisionRequestSchema), responses: { 200: jsonResponse('Participation division assigned with audit evidence', participationMutationResponseSchema), 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse } } },
    '/api/content/uploads': {
      post: {
        operationId: 'createContentUpload',
        tags: ['Content'],
        security: [{ cookieSession: [] }],
        parameters: [
          originParameter,
          csrfParameter,
          {
            name: 'X-Content-Filename',
            in: 'header',
            required: true,
            schema: { type: 'string', minLength: 1, maxLength: 1024 },
            description: 'Percent-encoded original display filename. Storage keys are always server generated.',
          },
        ],
        requestBody: {
          required: true,
          content: {
            '*/*': {
              schema: { type: 'string', format: 'binary', maxLength: 67_108_864 },
            },
          },
        },
        responses: {
          200: jsonResponse('Existing committed object reused by digest', contentObjectResponseSchema),
          201: jsonResponse('Temporary content object uploaded', contentObjectResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          409: errorResponse,
          413: errorResponse,
        },
      },
    },
    '/api/content/uploads/{contentObjectId}/commit': {
      post: {
        operationId: 'commitContentUpload',
        tags: ['Content'],
        security: [{ cookieSession: [] }],
        parameters: [
          { name: 'contentObjectId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          originParameter,
          csrfParameter,
        ],
        requestBody: jsonRequestBody(commitContentUploadRequestSchema),
        responses: {
          200: jsonResponse('Temporary upload committed after digest and object metadata verification', contentObjectResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
    '/api/content/challenge-assets/{assetId}/download': {
      get: {
        operationId: 'downloadChallengeAsset',
        tags: ['Content'],
        security: [{ cookieSession: [] }],
        parameters: [
          { name: 'assetId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: jsonResponse('Short-lived authorized challenge attachment download grant', contentDownloadResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    '/api/content/writeup-attachments/{referenceId}/download': {
      get: {
        operationId: 'downloadWriteupAttachment',
        tags: ['Content'],
        security: [{ cookieSession: [] }],
        parameters: [
          { name: 'referenceId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: jsonResponse('Short-lived authorized Writeup attachment download grant', contentDownloadResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    '/api/contests/{contestId}/writeup': {
      get: {
        operationId: 'getOwnWriteup',
        tags: ['Contests', 'Writeups'],
        security: [{ cookieSession: [] }],
        parameters: [
          { name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: jsonResponse('Accepted team Writeup state; ETag is "0" before the first version is saved', ownWriteupResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
      put: {
        operationId: 'saveOwnWriteupVersion',
        tags: ['Contests', 'Writeups'],
        security: [{ cookieSession: [] }],
        parameters: [
          { name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          originParameter,
          csrfParameter,
          writeupIfMatchParameter,
        ],
        requestBody: jsonRequestBody(saveWriteupRequestSchema),
        responses: {
          200: jsonResponse('A new immutable Writeup version was appended', writeupResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          428: errorResponse,
        },
      },
    },
    '/api/contests/{contestId}/writeup/submit': {
      post: {
        operationId: 'submitOwnWriteup',
        tags: ['Contests', 'Writeups'],
        security: [{ cookieSession: [] }],
        parameters: [
          { name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          originParameter,
          csrfParameter,
          writeupIfMatchParameter,
        ],
        responses: {
          200: jsonResponse('The current immutable version was fixed as the submitted version', writeupResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          428: errorResponse,
        },
      },
    },
    '/api/admin/contests/{contestId}/writeups': {
      get: {
        operationId: 'listManagedWriteups',
        tags: ['Administration', 'Contests', 'Writeups'],
        security: [{ cookieSession: [] }],
        parameters: [
          { name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'cursor', in: 'query', required: false, schema: openApiSchema(managedWriteupListRequestSchema.shape.cursor) },
          { name: 'limit', in: 'query', required: false, schema: openApiSchema(managedWriteupListRequestSchema.shape.limit) },
          { name: 'status', in: 'query', required: false, schema: openApiSchema(managedWriteupListRequestSchema.shape.status) },
        ],
        responses: {
          200: jsonResponse('Cursor-paginated Writeup management projection', managedWriteupListResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    '/api/admin/contests/{contestId}/writeups/{writeupId}/review': {
      post: {
        operationId: 'reviewWriteup',
        tags: ['Administration', 'Contests', 'Writeups'],
        security: [{ cookieSession: [] }],
        parameters: [
          { name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'writeupId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          originParameter,
          csrfParameter,
          writeupIfMatchParameter,
        ],
        requestBody: jsonRequestBody(reviewWriteupRequestSchema),
        responses: {
          200: jsonResponse('Submitted Writeup reviewed with transactional audit evidence', writeupResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          428: errorResponse,
        },
      },
    },
    '/api/admin/contests/{contestId}/writeups/{writeupId}/corrections': {
      post: {
        operationId: 'correctWriteup',
        tags: ['Administration', 'Contests', 'Writeups'],
        security: [{ cookieSession: [] }],
        parameters: [
          { name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'writeupId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          originParameter,
          csrfParameter,
          writeupIfMatchParameter,
        ],
        requestBody: jsonRequestBody(correctWriteupRequestSchema),
        responses: {
          200: jsonResponse('Authorized immutable correction appended and audited', writeupResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          428: errorResponse,
        },
      },
    },
    '/api/admin/contests/{contestId}/writeups/export': {
      get: {
        operationId: 'exportSubmittedWriteups',
        tags: ['Administration', 'Contests', 'Writeups'],
        security: [{ cookieSession: [] }],
        parameters: [
          { name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: 'Path-safe ZIP containing only submitted Writeup versions and verified attachments',
            content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
    '/api/admin/contests/{contestId}/exports': {
      post: {
        operationId: 'createContestPackageExport',
        tags: ['Administration', 'Contests', 'Content'],
        security: [{ cookieSession: [] }],
        parameters: [
          { name: 'contestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          originParameter,
          csrfParameter,
          idempotencyKeyParameter,
        ],
        requestBody: jsonRequestBody(createContestPackageExportRequestSchema),
        responses: {
          201: jsonResponse('Versioned Jeopardy package persisted as an immutable content object', contestPackageExportResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          413: errorResponse,
          428: errorResponse,
        },
      },
    },
    '/api/admin/contest-imports': {
      post: {
        operationId: 'importContestPackage',
        tags: ['Administration', 'Contests', 'Content'],
        security: [{ cookieSession: [] }],
        parameters: [originParameter, csrfParameter, idempotencyKeyParameter],
        requestBody: jsonRequestBody(importContestPackageRequestSchema),
        responses: {
          201: jsonResponse('Fully validated package imported atomically as a new draft contest', contestPackageImportResponseSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          413: errorResponse,
          428: errorResponse,
        },
      },
    },
    '/api/admin/contest-exports/{exportId}/download': {
      get: {
        operationId: 'downloadContestPackageExport',
        tags: ['Administration', 'Contests', 'Content'],
        security: [{ cookieSession: [] }],
        parameters: [
          { name: 'exportId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: 'Authorized immutable Jeopardy contest package',
            content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } },
          },
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
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
