import { handleCurrentIdentity, identityHttpDependencies } from '../../infrastructure/auth/identity-http'

export default defineEventHandler(event => handleCurrentIdentity(event, identityHttpDependencies(event)))
