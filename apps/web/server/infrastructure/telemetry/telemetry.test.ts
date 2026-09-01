import { createApp, eventHandler, setResponseStatus, toWebHandler } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { NodeSDK } from '@opentelemetry/sdk-node'
import { ControlPlaneTelemetry, initializeControlPlaneOpenTelemetry } from './telemetry'

const requestId = '018f47a2-4ef8-7e2c-9c24-6d68b7451f70'
const traceId = '0af7651916cd43dd8448eb211c80319c'

describe('control-plane OpenTelemetry correlation', () => {
  let sdk: NodeSDK

  beforeAll(() => {
    sdk = initializeControlPlaneOpenTelemetry({
      OTEL_TRACES_EXPORTER: 'none',
      OTEL_METRICS_EXPORTER: 'none',
    })
  })

  afterAll(async () => {
    await sdk.shutdown()
  })

  it('correlates request, instance and job identifiers without logging sensitive values', async () => {
    const lines: string[] = []
    const capture = (line: string) => lines.push(line)
    const telemetry = new ControlPlaneTelemetry({ info: capture, warn: capture, error: capture })
    const app = createApp()
    app.use(eventHandler(async (event) => {
      event.context.requestId = requestId
      telemetry.beginRequest(event)
      const requestTraceId = event.context.requestTelemetry!.span.spanContext().traceId
      await telemetry.withSpan(event, 'instance.start', {
        'sauryctf.contest.id': '018f47a2-4ef8-7e2c-9c24-6d68b7451f72',
      }, async () => {
        telemetry.instanceJobQueued({
          requestId,
          jobId: '018f47a2-4ef8-7e2c-9c24-6d68b7451f76',
          instanceId: '018f47a2-4ef8-7e2c-9c24-6d68b7451f74',
          contestId: '018f47a2-4ef8-7e2c-9c24-6d68b7451f72',
          challengeId: '018f47a2-4ef8-7e2c-9c24-6d68b7451f73',
          teamId: '018f47a2-4ef8-7e2c-9c24-6d68b7451f75',
          operation: 'ensure',
          provider: 'docker',
        })
        telemetry.emit('info', 'provider.result', {
          secret_envelope: 'encrypted-sensitive-value',
          submitted_flag: 'flag{sensitive-value}',
          authorization: 'Bearer sensitive-token',
        })
      })
      setResponseStatus(event, 202)
      telemetry.finishRequest(event)
      return { trace_id: requestTraceId }
    }))

    const response = await toWebHandler(app)(new Request('https://ctf.example.test/api/contests/123/instance', {
      method: 'POST',
      headers: { traceparent: `00-${traceId}-b7ad6b7169203331-01` },
    }))

    expect(response.status).toBe(202)
    expect(response.headers.get('traceparent')).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`, 'u'))
    await expect(response.json()).resolves.toEqual({ trace_id: traceId })
    const records = lines.map(line => JSON.parse(line) as Record<string, unknown>)
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'request.started', request_id: requestId, trace_id: traceId }),
      expect.objectContaining({
        event: 'instance.job_queued',
        request_id: requestId,
        trace_id: traceId,
        job_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f76',
        instance_id: '018f47a2-4ef8-7e2c-9c24-6d68b7451f74',
      }),
      expect.objectContaining({ event: 'request.completed', request_id: requestId, trace_id: traceId }),
    ]))
    const serialized = lines.join('\n')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).not.toContain('encrypted-sensitive-value')
    expect(serialized).not.toContain('flag{sensitive-value}')
    expect(serialized).not.toContain('sensitive-token')
  })
})
