import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import {
  handleChangeGlobalRole,
  identityHttpDependencies,
} from '../../../../../server/infrastructure/auth/identity-http'

export default defineEventHandler(async (event) => {
  const userId = uuidSchema.parse(getRouterParam(event, 'userId'))
  return handleChangeGlobalRole(event, identityHttpDependencies(event), userId)
})
