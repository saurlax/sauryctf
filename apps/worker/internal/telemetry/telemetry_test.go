package telemetry

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
)

func TestJSONLoggerRedactsSensitiveKeysAndErrorValues(t *testing.T) {
	var output bytes.Buffer
	logger := NewJSONLogger(&output)
	logger.Error("provider failed",
		"secret_envelope", "encrypted-sensitive-value",
		"submitted_flag", "flag{sensitive-value}",
		"authorization", "Bearer sensitive-token",
		"payload", map[string]any{"runtime": map[string]any{"secret_envelope": "nested-sensitive-value"}},
		"error", errors.New("connect postgresql://worker:database-password@database/ctf token=another-secret"),
	)

	serialized := output.String()
	for _, forbidden := range []string{"encrypted-sensitive-value", "flag{sensitive-value}", "sensitive-token", "nested-sensitive-value", "database-password", "another-secret"} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("structured log leaked %q: %s", forbidden, serialized)
		}
	}
	if strings.Count(serialized, redactedValue) < 4 {
		t.Fatalf("structured log did not apply centralized redaction: %s", serialized)
	}
	var record map[string]any
	if err := json.Unmarshal(output.Bytes(), &record); err != nil {
		t.Fatalf("structured log is not JSON: %v", err)
	}
	if record["secret_envelope"] != redactedValue || record["submitted_flag"] != redactedValue {
		t.Fatalf("sensitive fields were not redacted: %+v", record)
	}
}

func TestOpenTelemetryAndMetricsUseBoundedNonSensitiveAttributes(t *testing.T) {
	worker, err := New(context.Background(), Options{
		WorkerID: "worker-test-1",
		Getenv:   func(string) string { return "" },
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := worker.Shutdown(ctx); err != nil {
			t.Errorf("Shutdown() error = %v", err)
		}
	}()

	job := correlatedJob()
	jobContext, jobSpan := worker.StartJob(context.Background(), job, "worker-test-1", 2)
	if traceFields := jobSpan.TraceFields(); len(traceFields) != 4 {
		t.Fatalf("trace fields = %v, want trace and span identifiers", traceFields)
	}
	providerContext, providerSpan := worker.StartProvider(jobContext, "docker", "inspect")
	if providerContext == nil {
		t.Fatal("provider context is nil")
	}
	worker.EndProvider(providerSpan, "failed", "provider.unavailable")
	worker.EndJob(jobSpan, "retry_wait", "provider.unavailable")
	reconcileContext, reconcileSpan := worker.StartReconcile(context.Background())
	if reconcileContext == nil {
		t.Fatal("reconcile context is nil")
	}
	worker.EndReconcile(reconcileSpan, ReconcileResult{Orphans: 1, Unmanaged: 2, Failures: 1}, errors.New("safe test failure"))

	request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	response := httptest.NewRecorder()
	worker.MetricsHandler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("metrics response = %d", response.Code)
	}
	metrics := response.Body.String()
	for _, expected := range []string{
		`sauryctf_worker_instance_job_attempts_total{operation="inspect",outcome="retry_wait"} 1`,
		`sauryctf_worker_provider_operation_duration_seconds_count{operation="inspect",outcome="failed",provider="docker"} 1`,
		`sauryctf_worker_reconcile_cycles_total{outcome="failed"} 1`,
		`sauryctf_worker_reconcile_drift_total{kind="orphan"} 1`,
	} {
		if !strings.Contains(metrics, expected) {
			t.Fatalf("metrics omitted %q:\n%s", expected, metrics)
		}
	}
	for _, forbidden := range []string{string(job.JobID), string(job.InstanceID), "flag", "secret", "credential"} {
		if strings.Contains(strings.ToLower(metrics), strings.ToLower(forbidden)) {
			t.Fatalf("metrics exposed high-cardinality or sensitive value %q", forbidden)
		}
	}
}

func correlatedJob() contracts.InstanceJob {
	return contracts.InstanceJob{
		JobID:             contracts.UUID("018f47a2-4ef8-7e2c-9c24-6d68b7451001"),
		InstanceID:        contracts.UUID("018f47a2-4ef8-7e2c-9c24-6d68b7451011"),
		Operation:         contracts.OperationInspect,
		PayloadVersion:    1,
		DesiredGeneration: 4,
		IdempotencyKey:    "instance:correlation-test:generation:4:inspect",
		Payload: &contracts.InspectInstanceJobPayload{InstanceJobPayloadBase: contracts.InstanceJobPayloadBase{
			Schema:   contracts.InstanceJobSchemaName,
			Provider: contracts.ProviderDocker,
			Target: contracts.InstanceJobTarget{
				ContestID:          contracts.UUID("018f47a2-4ef8-7e2c-9c24-6d68b7451021"),
				ContestChallengeID: contracts.UUID("018f47a2-4ef8-7e2c-9c24-6d68b7451031"),
				ParticipationID:    contracts.UUID("018f47a2-4ef8-7e2c-9c24-6d68b7451041"),
				TeamID:             contracts.UUID("018f47a2-4ef8-7e2c-9c24-6d68b7451051"),
			},
		}},
	}
}
