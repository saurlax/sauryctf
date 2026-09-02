import { handleExecuteOperationalCommand } from '../../../infrastructure/administration/operations-http'

export default defineEventHandler(event => handleExecuteOperationalCommand(event))
