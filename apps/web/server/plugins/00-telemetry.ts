import {
  ControlPlaneTelemetry,
  initializeControlPlaneOpenTelemetry,
  setActiveControlPlaneTelemetry,
} from '../infrastructure/telemetry/telemetry'

export default defineNitroPlugin((nitroApp) => {
  const sdk = initializeControlPlaneOpenTelemetry(process.env)
  const telemetry = new ControlPlaneTelemetry()
  setActiveControlPlaneTelemetry(telemetry)

  nitroApp.hooks.hook('request', (event) => {
    event.context.telemetry = telemetry
  })
  nitroApp.hooks.hook('afterResponse', (event) => {
    telemetry.finishRequest(event)
  })
  nitroApp.hooks.hook('close', async () => {
    setActiveControlPlaneTelemetry(undefined)
    await sdk.shutdown()
  })
})
