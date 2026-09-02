package execution

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
)

type backendStub struct {
	operation string
	key       providers.InstanceKey
	spec      providers.InstanceSpec
	err       error
}

func (backend *backendStub) Ensure(_ context.Context, spec providers.InstanceSpec) (jobs.Observation, error) {
	backend.operation, backend.key, backend.spec = "ensure", spec.Key, spec
	return jobs.Observation{State: jobs.ObservedStarting, ProviderResourceID: "provider/resource"}, backend.err
}

func (backend *backendStub) Inspect(_ context.Context, key providers.InstanceKey) (jobs.Observation, error) {
	backend.operation, backend.key = "inspect", key
	return jobs.Observation{State: jobs.ObservedUnknown, ErrorCode: "provider.resource_missing", ErrorSummary: "Resource is missing"}, backend.err
}

func (backend *backendStub) Destroy(_ context.Context, key providers.InstanceKey) (jobs.Observation, error) {
	backend.operation, backend.key = "destroy", key
	return jobs.Observation{State: jobs.ObservedStopped}, backend.err
}

func (*backendStub) ListResources(context.Context) ([]providers.Resource, error) { return nil, nil }

type recorderStub struct {
	lease       jobs.Lease
	observation jobs.Observation
	err         error
	calls       int
}

func (recorder *recorderStub) RecordObservation(_ context.Context, lease jobs.Lease, observation jobs.Observation) error {
	recorder.calls++
	recorder.lease, recorder.observation = lease, observation
	return recorder.err
}

func TestProcessorExecutesEveryAllowedOperationWithTheFencedLease(t *testing.T) {
	tests := []struct {
		fixture       string
		wantOperation string
	}{
		{fixture: "ensure.json", wantOperation: "ensure"},
		{fixture: "inspect.json", wantOperation: "inspect"},
		{fixture: "destroy.json", wantOperation: "destroy"},
		{fixture: "reconcile.json", wantOperation: "destroy"},
	}
	for _, test := range tests {
		t.Run(test.fixture, func(t *testing.T) {
			backend := &backendStub{}
			recorder := &recorderStub{}
			processor, err := NewProcessor("sauryctf", backend, recorder)
			if err != nil {
				t.Fatal(err)
			}
			lease := jobs.Lease{Job: loadFixture(t, test.fixture), Owner: "worker-1", FencingToken: 17, AttemptNumber: 2}
			if err := processor.ProcessLease(context.Background(), lease); err != nil {
				t.Fatalf("ProcessLease() error = %v", err)
			}
			if backend.operation != test.wantOperation {
				t.Fatalf("provider operation = %q, want %q", backend.operation, test.wantOperation)
			}
			if backend.key.Instance != lease.Job.InstanceID || backend.key.Generation != lease.Job.DesiredGeneration || backend.key.Platform != "sauryctf" {
				t.Fatalf("provider key = %+v, want job identity", backend.key)
			}
			if recorder.calls != 1 || recorder.lease.FencingToken != 17 || recorder.lease.Owner != "worker-1" {
				t.Fatalf("recorded lease = %+v (calls %d), want active fenced lease", recorder.lease, recorder.calls)
			}
		})
	}
}

func TestProcessorPassesRuntimeAndExpiryToEnsure(t *testing.T) {
	backend := &backendStub{}
	recorder := &recorderStub{}
	processor, _ := NewProcessor("sauryctf", backend, recorder)
	job := loadFixture(t, "ensure.json")
	if err := processor.ProcessLease(context.Background(), jobs.Lease{Job: job, Owner: "worker-1", FencingToken: 1}); err != nil {
		t.Fatal(err)
	}
	if backend.spec.Runtime.Image == "" || backend.spec.Runtime.SecretEnvelope == nil {
		t.Fatalf("ensure runtime was not preserved: %+v", backend.spec.Runtime)
	}
	wantExpiry, _ := time.Parse("2006-01-02T15:04:05.000Z", "2026-09-02T09:30:00.000Z")
	if backend.spec.ExpiresAt == nil || !backend.spec.ExpiresAt.Equal(wantExpiry) {
		t.Fatalf("ensure expiry = %v, want %v", backend.spec.ExpiresAt, wantExpiry)
	}
}

func TestProcessorDoesNotRecordProviderFailure(t *testing.T) {
	backend := &backendStub{err: jobs.PermanentError("provider.image_missing", "Image is unavailable", errors.New("registry detail"))}
	recorder := &recorderStub{}
	processor, _ := NewProcessor("sauryctf", backend, recorder)
	err := processor.ProcessLease(context.Background(), jobs.Lease{Job: loadFixture(t, "ensure.json"), Owner: "worker-1", FencingToken: 1})
	failure := jobs.ClassifyFailure(err)
	if failure.Kind != jobs.FailurePermanent || failure.Code != "provider.image_missing" || recorder.calls != 0 {
		t.Fatalf("failure = %+v, recorder calls = %d", failure, recorder.calls)
	}
}

func TestProcessorClassifiesFencedObservationRejectionAsRetryable(t *testing.T) {
	backend := &backendStub{}
	recorder := &recorderStub{err: jobs.ErrObservationRejected}
	processor, _ := NewProcessor("sauryctf", backend, recorder)
	err := processor.ProcessLease(context.Background(), jobs.Lease{Job: loadFixture(t, "inspect.json"), Owner: "worker-1", FencingToken: 1})
	failure := jobs.ClassifyFailure(err)
	if failure.Kind != jobs.FailureRetryable || failure.Code != "worker.observation_rejected" {
		t.Fatalf("failure = %+v, want retryable observation rejection", failure)
	}
}

func loadFixture(t *testing.T, name string) contracts.InstanceJob {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve processor test source")
	}
	path := filepath.Clean(filepath.Join(filepath.Dir(filename), "../../../../contracts/fixtures/instance-jobs/v1", name))
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	job, err := contracts.DecodeInstanceJob(source)
	if err != nil {
		t.Fatal(err)
	}
	return job
}
