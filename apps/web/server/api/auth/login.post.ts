import { handleLogin, identityHttpDependencies } from '../../infrastructure/auth/identity-http'

export default defineEventHandler(event => handleLogin(event, identityHttpDependencies(event)))
