import { getRouterParam } from 'h3'
import { uuidSchema } from '../../../../../shared/contracts/common-types'
import { handleChangeUserStatus, identityHttpDependencies } from '../../../../infrastructure/auth/identity-http'

export default defineEventHandler((event) => {
  const userId = uuidSchema.parse(getRouterParam(event, 'userId'))
  return handleChangeUserStatus(event, identityHttpDependencies(event), userId)
})
