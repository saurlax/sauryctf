import { handleEmailVerificationRequest, identityHttpDependencies } from '../../../../infrastructure/auth/identity-http'

export default defineEventHandler(event => handleEmailVerificationRequest(event, identityHttpDependencies(event)))
