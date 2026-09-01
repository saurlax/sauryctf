import { handleListManagedIdentities, identityHttpDependencies } from '../../../infrastructure/auth/identity-http'

export default defineEventHandler(event => handleListManagedIdentities(event, identityHttpDependencies(event)))
