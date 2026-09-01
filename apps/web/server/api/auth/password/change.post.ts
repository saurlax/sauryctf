import { handleChangePassword, identityHttpDependencies } from '../../../infrastructure/auth/identity-http'

export default defineEventHandler(event => handleChangePassword(event, identityHttpDependencies(event)))
