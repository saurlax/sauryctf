import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  context as otelContext,
  metrics,
  propagation,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { BatchSpanProcessor, type ReadableSpan, type SpanProcessor } from '@opentelemetry/sdk-trace-base'
import type { H3Event } from 'h3'
import { getRequestHeaders, setResponseHeader } from 'h3'
import { structuredLog } from './logging'

type LogLevel = 'info' | 'warn' | 'error'
type LogSink = (line: string) => void

export interface RequestTelemetryContext {
  requestId: string
  route: string
  startedAt: bigint
  span: Span
  finished: boolean
}

export interface OperationalMetricSnapshot {
  mailDeliveries: Record<string, number>
  instanceJobs: Record<string, number>
  instances: Record<string, number>
}

export interface InstanceJobCorrelation {
  requestId: string
  jobId: string
  instanceId: string
  contestId: string
  challengeId: string
  teamId: string
  operation: 'ensure' | 'destroy'
  provider: 'docker' | 'kubernetes'
}

class DiscardSpanProcessor implements SpanProcessor {
  onStart() {}
  onEnd(_span: ReadableSpan) {}
  forceFlush(): Promise<void> { return Promise.resolve() }
  shutdown(): Promise<void> { return Promise.resolve() }
}

export function initializeControlPlaneOpenTelemetry(environment: NodeJS.ProcessEnv): NodeSDK {
  const traceExportEnabled = exporterEnabled(environment, 'OTEL_TRACES_EXPORTER', 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT')
  const metricExportEnabled = exporterEnabled(environment, 'OTEL_METRICS_EXPORTER', 'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT')
  const sdk = new NodeSDK({
    serviceName: environment.OTEL_SERVICE_NAME?.trim() || 'sauryctf-control-plane',
    spanProcessors: traceExportEnabled
      ? [new BatchSpanProcessor(new OTLPTraceExporter())]
      : [new DiscardSpanProcessor()],
    metricReaders: metricExportEnabled
      ? [new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter(),
          exportIntervalMillis: positiveInteger(environment.OTEL_METRIC_EXPORT_INTERVAL, 30_000),
        })]
      : [],
  })
  sdk.start()
  return sdk
}

function exporterEnabled(environment: NodeJS.ProcessEnv, signalVariable: string, endpointVariable: string) {
  if (environment.OTEL_SDK_DISABLED === 'true' || environment[signalVariable] === 'none') return false
  return Boolean(environment[endpointVariable]?.trim() || environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim())
}

function positiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export class ControlPlaneTelemetry {
  private readonly tracer = trace.getTracer('sauryctf-control-plane')
  private readonly meter = metrics.getMeter('sauryctf-control-plane')
  private readonly apiRequests = this.meter.createCounter('sauryctf.api.requests')
  private readonly apiDuration = this.meter.createHistogram('sauryctf.api.duration', { unit: 'ms' })
  private readonly loginFailures = this.meter.createCounter('sauryctf.auth.login_failures')
  private readonly mailDispatches = this.meter.createCounter('sauryctf.mail.outbox_dispatches')
  private readonly submissions = this.meter.createCounter('sauryctf.submissions.processed')
  private readonly scoreboardReads = this.meter.createCounter('sauryctf.scoreboard.reads')
  private readonly instanceCommands = this.meter.createCounter('sauryctf.instance.commands')
  private readonly instanceJobsEnqueued = this.meter.createCounter('sauryctf.instance.jobs_enqueued')
  private snapshot: OperationalMetricSnapshot = { mailDeliveries: {}, instanceJobs: {}, instances: {} }

  constructor(private readonly sink: Partial<Record<LogLevel, LogSink>> = defaultSink) {
    this.meter.createObservableGauge('sauryctf.mail.deliveries').addCallback((result) => {
      for (const [status, value] of Object.entries(this.snapshot.mailDeliveries)) result.observe(value, { status })
    })
    this.meter.createObservableGauge('sauryctf.instance.job_queue').addCallback((result) => {
      for (const [status, value] of Object.entries(this.snapshot.instanceJobs)) result.observe(value, { status })
    })
    this.meter.createObservableGauge('sauryctf.instances').addCallback((result) => {
      for (const [state, value] of Object.entries(this.snapshot.instances)) result.observe(value, { state })
    })
  }

  beginRequest(event: H3Event) {
    const requestId = event.context.requestId
    if (!requestId) return
    const route = normalizeRoute(event.path)
    const parent = propagation.extract(ROOT_CONTEXT, getRequestHeaders(event), headerGetter)
    const span = this.tracer.startSpan('http.request', {
      kind: SpanKind.SERVER,
      attributes: {
        'http.request.method': event.method,
        'http.route': route,
        'sauryctf.request.id': requestId,
      },
    }, parent)
    const spanContext = span.spanContext()
    event.context.requestTelemetry = {
      requestId,
      route,
      startedAt: process.hrtime.bigint(),
      span,
      finished: false,
    }
    setResponseHeader(event, 'traceparent', traceparent(spanContext.traceId, spanContext.spanId, spanContext.traceFlags))
    this.emit('info', 'request.started', {
      request_id: requestId,
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
      method: event.method,
      route,
    })
  }

  finishRequest(event: H3Event) {
    const current = event.context.requestTelemetry
    if (!current || current.finished) return
    current.finished = true
    const statusCode = event.node.res.statusCode
    const durationMs = Number(process.hrtime.bigint() - current.startedAt) / 1_000_000
    const attributes = {
      method: event.method,
      route: current.route,
      status_code: statusCode,
    }
    this.apiRequests.add(1, attributes)
    this.apiDuration.record(durationMs, attributes)
    current.span.setAttribute('http.response.status_code', statusCode)
    current.span.setStatus({ code: statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK })
    const spanContext = current.span.spanContext()
    this.emit(statusCode >= 500 ? 'error' : 'info', 'request.completed', {
      request_id: current.requestId,
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
      ...attributes,
      duration_ms: durationMs,
    })
    current.span.end()
  }

  async withSpan<T>(event: H3Event, name: string, attributes: Attributes, operation: () => Promise<T>): Promise<T> {
    const request = event.context.requestTelemetry
    const parent = request ? trace.setSpan(ROOT_CONTEXT, request.span) : otelContext.active()
    return this.tracer.startActiveSpan(name, { attributes }, parent, async (span) => {
      try {
        const result = await operation()
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      }
      catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.name : 'UnknownError',
        })
        throw error
      }
      finally {
        span.end()
      }
    })
  }

  recordLoginFailure(code: string) {
    this.loginFailures.add(1, { code })
  }

  recordMailDispatch(outcome: 'processed' | 'failed', count = 1) {
    this.mailDispatches.add(count, { outcome })
  }

  recordSubmission(result: string, mode: string) {
    this.submissions.add(1, { result, mode })
  }

  recordScoreboard(view: 'public' | 'internal', freshness: string) {
    this.scoreboardReads.add(1, { view, freshness })
  }

  recordInstanceCommand(command: 'start' | 'renew' | 'destroy', outcome: 'accepted' | 'rejected') {
    this.instanceCommands.add(1, { command, outcome })
  }

  instanceJobQueued(correlation: InstanceJobCorrelation) {
    this.instanceJobsEnqueued.add(1, {
      operation: correlation.operation,
      provider: correlation.provider,
    })
    const active = trace.getActiveSpan()?.spanContext()
    this.emit('info', 'instance.job_queued', {
      request_id: correlation.requestId,
      trace_id: active?.traceId,
      span_id: active?.spanId,
      job_id: correlation.jobId,
      instance_id: correlation.instanceId,
      contest_id: correlation.contestId,
      challenge_id: correlation.challengeId,
      team_id: correlation.teamId,
      operation: correlation.operation,
      provider: correlation.provider,
    })
  }

  updateOperationalSnapshot(snapshot: OperationalMetricSnapshot) {
    this.snapshot = structuredClone(snapshot)
  }

  emit(level: LogLevel, event: string, attributes: Record<string, unknown>) {
    const line = structuredLog(level, event, attributes)
    ;(this.sink[level] ?? defaultSink[level])(line)
  }
}

let activeTelemetry: ControlPlaneTelemetry | undefined

export function setActiveControlPlaneTelemetry(telemetry: ControlPlaneTelemetry | undefined) {
  activeTelemetry = telemetry
}

export function activeControlPlaneTelemetry() {
  return activeTelemetry
}

const defaultSink: Record<LogLevel, LogSink> = {
  info: line => console.info(line),
  warn: line => console.warn(line),
  error: line => console.error(line),
}

const headerGetter = {
  get(carrier: Record<string, string | undefined>, key: string) {
    return carrier[key.toLowerCase()]
  },
  keys(carrier: Record<string, string | undefined>) {
    return Object.keys(carrier)
  },
}

function traceparent(traceId: string, spanId: string, flags: number) {
  return `00-${traceId}-${spanId}-${flags.toString(16).padStart(2, '0')}`
}

function normalizeRoute(path: string) {
  return path.split('?')[0]!
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu, ':id')
}
