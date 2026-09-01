import { handleLogout, identityHttpDependencies } from '../../infrastructure/auth/identity-http'

export default defineEventHandler(event => handleLogout(event, identityHttpDependencies(event)))
