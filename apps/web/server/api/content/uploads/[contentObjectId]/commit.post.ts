import { handleCommitContentUpload } from '../../../../infrastructure/content/content-http'

export default defineEventHandler(event => handleCommitContentUpload(
  event,
  getRouterParam(event, 'contentObjectId') ?? '',
))
