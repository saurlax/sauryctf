import { handleEmailVerificationConfirm, identityHttpDependencies } from '../../../../infrastructure/auth/identity-http'

export default defineEventHandler(event => handleEmailVerificationConfirm(event, identityHttpDependencies(event)))
