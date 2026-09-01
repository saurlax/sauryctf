import {
  handleChangeEmail,
  identityHttpDependencies,
} from '../../../../server/infrastructure/auth/identity-http'

export default defineEventHandler(event => handleChangeEmail(event, identityHttpDependencies(event)))
