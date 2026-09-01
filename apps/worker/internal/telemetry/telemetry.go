// Package telemetry provides private worker tracing and metrics without
// exposing business routes or sensitive instance payloads.
package telemetry

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

const defaultServiceName = "sauryctf-instance-worker"

type Options struct {
	ServiceName string
	WorkerID    string
	Getenv      func(string) string
}

type Worker struct {
	tracer            trace.Tracer
	provider          *sdktrace.TracerProvider
	registry          *prometheus.Registry
	jobAttempts       *prometheus.CounterVec
	providerDuration  *prometheus.HistogramVec
	reconcileCycles   *prometheus.CounterVec
	reconcileDuration prometheus.Histogram
	reconcileDrift    *prometheus.CounterVec
}

func New(ctx context.Context, options Options) (*Worker, error) {
	if options.Getenv == nil {
		options.Getenv = func(string) string { return "" }
	}
	serviceName := strings.TrimSpace(options.ServiceName)
	if serviceName == "" {
		serviceName = defaultServiceName
	}
	resourceValue := resource.NewWithAttributes(
		semconv.SchemaURL,
		semconv.ServiceName(serviceName),
		attribute.String("sauryctf.worker.id", options.WorkerID),
	)
	providerOptions := []sdktrace.TracerProviderOption{sdktrace.WithResource(resourceValue)}
	if exporterEnabled(options.Getenv) {
		exporter, err := otlptracehttp.New(ctx)
		if err != nil {
			return nil, err
		}
		providerOptions = append(providerOptions, sdktrace.WithBatcher(exporter))
	}
	provider := sdktrace.NewTracerProvider(providerOptions...)
	registry := prometheus.NewRegistry()
	worker := &Worker{
		tracer:   provider.Tracer(defaultServiceName),
		provider: provider,
		registry: registry,
		jobAttempts: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "sauryctf_worker_instance_job_attempts_total",
			Help: "Finalized instance job attempts by operation and outcome.",
		}, []string{"operation", "outcome"}),
		providerDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "sauryctf_worker_provider_operation_duration_seconds",
			Help:    "Instance provider operation latency without payload values.",
			Buckets: prometheus.DefBuckets,
		}, []string{"provider", "operation", "outcome"}),
		reconcileCycles: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "sauryctf_worker_reconcile_cycles_total",
			Help: "Completed reconcile cycles by outcome.",
		}, []string{"outcome"}),
		reconcileDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "sauryctf_worker_reconcile_duration_seconds",
			Help:    "Duration of instance reconciliation cycles.",
			Buckets: prometheus.DefBuckets,
		}),
		reconcileDrift: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "sauryctf_worker_reconcile_drift_total",
			Help: "Observed instance drift by safe bounded category.",
		}, []string{"kind"}),
	}
	registry.MustRegister(
		worker.jobAttempts,
		worker.providerDuration,
		worker.reconcileCycles,
		worker.reconcileDuration,
		worker.reconcileDrift,
	)
	return worker, nil
}

func exporterEnabled(getenv func(string) string) bool {
	if strings.EqualFold(strings.TrimSpace(getenv("OTEL_SDK_DISABLED")), "true") || strings.EqualFold(strings.TrimSpace(getenv("OTEL_TRACES_EXPORTER")), "none") {
		return false
	}
	return strings.TrimSpace(getenv("OTEL_EXPORTER_OTLP_ENDPOINT")) != "" || strings.TrimSpace(getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")) != ""
}

func (worker *Worker) Shutdown(ctx context.Context) error {
	if worker == nil || worker.provider == nil {
		return nil
	}
	return worker.provider.Shutdown(ctx)
}

func (worker *Worker) MetricsHandler() http.Handler {
	return promhttp.HandlerFor(worker.registry, promhttp.HandlerOpts{EnableOpenMetrics: true})
}

type JobCorrelation struct {
	JobID           string
	InstanceID      string
	ContestID       string
	ChallengeID     string
	ParticipationID string
	TeamID          string
	Operation       string
	Provider        string
}

func CorrelateJob(job contracts.InstanceJob) JobCorrelation {
	base := payloadBase(job.Payload)
	return JobCorrelation{
		JobID: string(job.JobID), InstanceID: string(job.InstanceID),
		ContestID: string(base.Target.ContestID), ChallengeID: string(base.Target.ContestChallengeID),
		ParticipationID: string(base.Target.ParticipationID), TeamID: string(base.Target.TeamID),
		Operation: string(job.Operation), Provider: string(base.Provider),
	}
}

func payloadBase(payload contracts.InstanceJobPayload) contracts.InstanceJobPayloadBase {
	switch value := payload.(type) {
	case *contracts.EnsureInstanceJobPayload:
		return value.InstanceJobPayloadBase
	case contracts.EnsureInstanceJobPayload:
		return value.InstanceJobPayloadBase
	case *contracts.InspectInstanceJobPayload:
		return value.InstanceJobPayloadBase
	case contracts.InspectInstanceJobPayload:
		return value.InstanceJobPayloadBase
	case *contracts.DestroyInstanceJobPayload:
		return value.InstanceJobPayloadBase
	case contracts.DestroyInstanceJobPayload:
		return value.InstanceJobPayloadBase
	case *contracts.ReconcileInstanceJobPayload:
		return value.InstanceJobPayloadBase
	case contracts.ReconcileInstanceJobPayload:
		return value.InstanceJobPayloadBase
	default:
		return contracts.InstanceJobPayloadBase{}
	}
}

type JobSpan struct {
	span        trace.Span
	correlation JobCorrelation
	startedAt   time.Time
}

func (worker *Worker) StartJob(ctx context.Context, job contracts.InstanceJob, workerID string, attempt int) (context.Context, *JobSpan) {
	correlation := CorrelateJob(job)
	ctx, span := worker.tracer.Start(ctx, "instance_job."+correlation.Operation,
		trace.WithSpanKind(trace.SpanKindConsumer),
		trace.WithAttributes(
			attribute.String("sauryctf.job.id", correlation.JobID),
			attribute.String("sauryctf.instance.id", correlation.InstanceID),
			attribute.String("sauryctf.contest.id", correlation.ContestID),
			attribute.String("sauryctf.challenge.id", correlation.ChallengeID),
			attribute.String("sauryctf.team.id", correlation.TeamID),
			attribute.String("sauryctf.worker.id", workerID),
			attribute.Int("sauryctf.job.attempt", attempt),
			attribute.String("sauryctf.job.operation", correlation.Operation),
			attribute.String("sauryctf.provider", correlation.Provider),
		),
	)
	return ctx, &JobSpan{span: span, correlation: correlation, startedAt: time.Now()}
}

func (worker *Worker) EndJob(jobSpan *JobSpan, outcome, errorCode string) {
	if worker == nil || jobSpan == nil {
		return
	}
	worker.jobAttempts.WithLabelValues(jobSpan.correlation.Operation, outcome).Inc()
	worker.providerDuration.WithLabelValues(jobSpan.correlation.Provider, jobSpan.correlation.Operation, outcome).Observe(time.Since(jobSpan.startedAt).Seconds())
	jobSpan.span.SetAttributes(attribute.String("sauryctf.job.outcome", outcome))
	if errorCode != "" {
		jobSpan.span.SetAttributes(attribute.String("error.type", errorCode))
	}
	if outcome == "succeeded" || outcome == "superseded" {
		jobSpan.span.SetStatus(codes.Ok, "")
	} else {
		jobSpan.span.SetStatus(codes.Error, errorCode)
	}
	jobSpan.span.End()
}

func (span *JobSpan) TraceFields() []any {
	if span == nil {
		return nil
	}
	context := span.span.SpanContext()
	if !context.IsValid() {
		return nil
	}
	return []any{"trace_id", context.TraceID().String(), "span_id", context.SpanID().String()}
}

type ProviderSpan struct {
	span      trace.Span
	provider  string
	operation string
	startedAt time.Time
}

func (worker *Worker) StartProvider(ctx context.Context, provider, operation string) (context.Context, *ProviderSpan) {
	ctx, span := worker.tracer.Start(ctx, "provider."+operation, trace.WithAttributes(
		attribute.String("sauryctf.provider", provider),
		attribute.String("sauryctf.provider.operation", operation),
	))
	return ctx, &ProviderSpan{span: span, provider: provider, operation: operation, startedAt: time.Now()}
}

func (worker *Worker) EndProvider(providerSpan *ProviderSpan, outcome, errorCode string) {
	if worker == nil || providerSpan == nil {
		return
	}
	worker.providerDuration.WithLabelValues(providerSpan.provider, providerSpan.operation, outcome).Observe(time.Since(providerSpan.startedAt).Seconds())
	if errorCode != "" {
		providerSpan.span.SetAttributes(attribute.String("error.type", errorCode))
	}
	if outcome == "succeeded" {
		providerSpan.span.SetStatus(codes.Ok, "")
	} else {
		providerSpan.span.SetStatus(codes.Error, errorCode)
	}
	providerSpan.span.End()
}

type ReconcileResult struct {
	Orphans   int
	Unmanaged int
	Failures  int
	Ensured   int
	Destroyed int
}

type ReconcileSpan struct {
	span      trace.Span
	startedAt time.Time
}

func (worker *Worker) StartReconcile(ctx context.Context) (context.Context, *ReconcileSpan) {
	ctx, span := worker.tracer.Start(ctx, "instance.reconcile", trace.WithSpanKind(trace.SpanKindInternal))
	return ctx, &ReconcileSpan{span: span, startedAt: time.Now()}
}

func (worker *Worker) EndReconcile(span *ReconcileSpan, result ReconcileResult, cycleError error) {
	if worker == nil || span == nil {
		return
	}
	outcome := "succeeded"
	if cycleError != nil {
		outcome = "failed"
		span.span.SetStatus(codes.Error, "reconcile.failed")
	} else {
		span.span.SetStatus(codes.Ok, "")
	}
	worker.reconcileCycles.WithLabelValues(outcome).Inc()
	worker.reconcileDuration.Observe(time.Since(span.startedAt).Seconds())
	for kind, count := range map[string]int{
		"orphan": result.Orphans, "unmanaged": result.Unmanaged, "failure": result.Failures,
		"ensured": result.Ensured, "destroyed": result.Destroyed,
	} {
		if count > 0 {
			worker.reconcileDrift.WithLabelValues(kind).Add(float64(count))
		}
	}
	span.span.SetAttributes(
		attribute.Int("sauryctf.reconcile.orphans", result.Orphans),
		attribute.Int("sauryctf.reconcile.unmanaged", result.Unmanaged),
		attribute.Int("sauryctf.reconcile.failures", result.Failures),
	)
	span.span.End()
}
