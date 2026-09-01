import { handlePasswordResetConfirm, identityHttpDependencies } from '../../../../infrastructure/auth/identity-http'

export default defineEventHandler(event => handlePasswordResetConfirm(event, identityHttpDependencies(event)))
