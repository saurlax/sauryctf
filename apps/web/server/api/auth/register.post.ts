import { handleRegister, identityHttpDependencies } from '../../infrastructure/auth/identity-http'

export default defineEventHandler(event => handleRegister(event, identityHttpDependencies(event)))
