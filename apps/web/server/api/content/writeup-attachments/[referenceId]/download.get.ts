import { handleWriteupAttachmentDownload } from '../../../../infrastructure/content/content-http'

export default defineEventHandler(event => handleWriteupAttachmentDownload(
  event,
  getRouterParam(event, 'referenceId') ?? '',
))
