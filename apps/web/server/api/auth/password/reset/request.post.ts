import { handlePasswordResetRequest, identityHttpDependencies } from '../../../../infrastructure/auth/identity-http'

export default defineEventHandler(event => handlePasswordResetRequest(event, identityHttpDependencies(event)))
