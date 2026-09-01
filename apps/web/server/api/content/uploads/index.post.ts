import { handleCreateContentUpload } from '../../../infrastructure/content/content-http'

export default defineEventHandler(event => handleCreateContentUpload(event))
