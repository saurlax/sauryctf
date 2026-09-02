import { evaluateControlPlaneReadiness } from '../../domains/administration/readiness'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')

  const result = await evaluateControlPlaneReadiness(
    process.env,
    event.context.services?.readiness,
    event.context.requestId,
  )
  setResponseStatus(event, result.statusCode)
  return result.body
})
