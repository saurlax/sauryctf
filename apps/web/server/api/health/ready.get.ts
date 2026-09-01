import { evaluateControlPlaneReadiness } from '../../domains/administration/readiness'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'cache-control', 'no-store')

  const result = evaluateControlPlaneReadiness(process.env)
  setResponseStatus(event, result.statusCode)
  return result.body
})
