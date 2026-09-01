package jobs

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
)

type fakeRepository struct {
	mu            sync.Mutex
	lease         Lease
	claimed       bool
	renewError    error
	completeCalls int
	releaseCalls  int
	completed     chan struct{}
	released      chan struct{}
}

func (repository *fakeRepository) ClaimBatch(context.Context, string, int, time.Duration) ([]Lease, error) {
	repository.mu.Lock()
	defer repository.mu.Unlock()
	if repository.claimed {
		return nil, nil
	}
	repository.claimed = true
	return []Lease{repository.lease}, nil
}

func (repository *fakeRepository) Renew(context.Context, Lease, time.Duration) error {
	return repository.renewError
}

func (repository *fakeRepository) Complete(context.Context, Lease) error {
	repository.mu.Lock()
	defer repository.mu.Unlock()
	repository.completeCalls++
	closeOnce(repository.completed)
	return nil
}

func (repository *fakeRepository) Release(context.Context, Lease) error {
	repository.mu.Lock()
	defer repository.mu.Unlock()
	repository.releaseCalls++
	closeOnce(repository.released)
	return nil
}

type processorFunc func(context.Context, contracts.InstanceJob) error

func (function processorFunc) Process(ctx context.Context, job contracts.InstanceJob) error {
	return function(ctx, job)
}

func TestRunnerCompletesSuccessfulJob(t *testing.T) {
	repository := newFakeRepository(t)
	runner := newTestRunner(repository, processorFunc(func(context.Context, contracts.InstanceJob) error {
		return nil
	}))

	cancel, stopped := runRunner(t, runner)
	waitClosed(t, repository.completed, "job completion")
	cancel()
	waitRunner(t, stopped)

	repository.mu.Lock()
	defer repository.mu.Unlock()
	if repository.completeCalls != 1 || repository.releaseCalls != 0 {
		t.Fatalf("complete/release calls = %d/%d, want 1/0", repository.completeCalls, repository.releaseCalls)
	}
}

func TestRunnerReleasesFailedJob(t *testing.T) {
	repository := newFakeRepository(t)
	runner := newTestRunner(repository, processorFunc(func(context.Context, contracts.InstanceJob) error {
		return errors.New("provider failed")
	}))

	cancel, stopped := runRunner(t, runner)
	waitClosed(t, repository.released, "job release")
	cancel()
	waitRunner(t, stopped)

	repository.mu.Lock()
	defer repository.mu.Unlock()
	if repository.completeCalls != 0 || repository.releaseCalls != 1 {
		t.Fatalf("complete/release calls = %d/%d, want 0/1", repository.completeCalls, repository.releaseCalls)
	}
}

func TestRunnerCancelsProcessorAndReleasesOnRenewalFailure(t *testing.T) {
	repository := newFakeRepository(t)
	repository.renewError = ErrLeaseLost
	processorCancelled := make(chan struct{})
	runner := newTestRunner(repository, processorFunc(func(ctx context.Context, _ contracts.InstanceJob) error {
		<-ctx.Done()
		close(processorCancelled)
		return ctx.Err()
	}))
	runner.config.RenewInterval = 5 * time.Millisecond

	cancel, stopped := runRunner(t, runner)
	waitClosed(t, processorCancelled, "processor cancellation")
	waitClosed(t, repository.released, "job release")
	cancel()
	waitRunner(t, stopped)
}

func TestRunnerGracefulStopWaitsForActiveJobRelease(t *testing.T) {
	repository := newFakeRepository(t)
	processorStarted := make(chan struct{})
	runner := newTestRunner(repository, processorFunc(func(ctx context.Context, _ contracts.InstanceJob) error {
		close(processorStarted)
		<-ctx.Done()
		return ctx.Err()
	}))

	cancel, stopped := runRunner(t, runner)
	waitClosed(t, processorStarted, "processor start")
	cancel()
	waitClosed(t, repository.released, "job release")
	waitRunner(t, stopped)
}

func newFakeRepository(t *testing.T) *fakeRepository {
	t.Helper()
	return &fakeRepository{
		lease: Lease{
			Job:          loadInspectFixture(t),
			Owner:        "worker-test-1",
			FencingToken: 1,
			LeaseUntil:   time.Now().Add(time.Minute),
		},
		completed: make(chan struct{}),
		released:  make(chan struct{}),
	}
}

func newTestRunner(repository Repository, processor Processor) *Runner {
	return NewRunner(repository, processor, RunnerConfig{
		WorkerID:         "worker-test-1",
		BatchSize:        1,
		Concurrency:      1,
		LeaseDuration:    time.Minute,
		RenewInterval:    30 * time.Second,
		PollInterval:     5 * time.Millisecond,
		OperationTimeout: time.Second,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func runRunner(t *testing.T, runner *Runner) (context.CancelFunc, <-chan error) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan error, 1)
	go func() { stopped <- runner.Run(ctx) }()
	return cancel, stopped
}

func waitRunner(t *testing.T, stopped <-chan error) {
	t.Helper()
	select {
	case err := <-stopped:
		if err != nil {
			t.Fatalf("Runner.Run() error = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Runner.Run() did not stop")
	}
}

func waitClosed(t *testing.T, channel <-chan struct{}, event string) {
	t.Helper()
	select {
	case <-channel:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for %s", event)
	}
}

func closeOnce(channel chan struct{}) {
	select {
	case <-channel:
	default:
		close(channel)
	}
}

func loadInspectFixture(t *testing.T) contracts.InstanceJob {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve test source path")
	}
	path := filepath.Clean(filepath.Join(filepath.Dir(filename), "../../../../contracts/fixtures/instance-jobs/v1/inspect.json"))
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
