import { handleListMonitoring } from '../../../infrastructure/administration/monitoring-http'

export default defineEventHandler(event => handleListMonitoring(event))
