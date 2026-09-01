import { handleChallengeAssetDownload } from '../../../../infrastructure/content/content-http'

export default defineEventHandler(event => handleChallengeAssetDownload(
  event,
  getRouterParam(event, 'assetId') ?? '',
))
