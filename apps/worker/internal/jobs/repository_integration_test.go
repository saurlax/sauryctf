package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
)

func TestPostgresRepositoryUsesFencingForExpiredLeases(t *testing.T) {
	pool := openJobsTestDatabase(t)
	repository := NewPostgresRepository(pool)
	jobID := insertInspectJob(t, pool, 1)
	ctx := context.Background()

	first := claimOne(t, repository, "worker-a", 5*time.Second)
	if first.FencingToken != 1 {
		t.Fatalf("first fencing token = %d, want 1", first.FencingToken)
	}
	if _, err := pool.Exec(ctx, "UPDATE instance_jobs SET lease_until = clock_timestamp() - interval '1 second' WHERE id = $1", jobID); err != nil {
		t.Fatal(err)
	}
	second := claimOne(t, repository, "worker-b", 5*time.Second)
	if second.FencingToken != 2 {
		t.Fatalf("second fencing token = %d, want 2", second.FencingToken)
	}
	if _, err := repository.Complete(ctx, first); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("stale Complete() error = %v, want ErrLeaseLost", err)
	}
	if _, err := repository.Complete(ctx, second); err != nil {
		t.Fatalf("current Complete() error = %v", err)
	}

	var status string
	var fencingToken int64
	var attemptCount int
	if err := pool.QueryRow(ctx, "SELECT status, fencing_token, attempt_count FROM instance_jobs WHERE id = $1", jobID).Scan(&status, &fencingToken, &attemptCount); err != nil {
		t.Fatal(err)
	}
	if status != "succeeded" || fencingToken != 2 || attemptCount != 2 {
		t.Fatalf("final status/token/attempts = %s/%d/%d, want succeeded/2/2", status, fencingToken, attemptCount)
	}
	assertAttempt(t, pool, jobID, 1, "lease_lost", "worker.lease_expired")
	assertSuccessfulAttempt(t, pool, jobID, 2)
}

func TestPostgresRepositoryRenewsOnlyCurrentLease(t *testing.T) {
	pool := openJobsTestDatabase(t)
	repository := NewPostgresRepository(pool)
	jobID := insertInspectJob(t, pool, 1)
	ctx := context.Background()
	lease := claimOne(t, repository, "worker-a", 5*time.Second)
	previousExpiry := lease.LeaseUntil

	if err := repository.Renew(ctx, lease, 20*time.Second); err != nil {
		t.Fatalf("Renew() error = %v", err)
	}
	var renewedExpiry time.Time
	if err := pool.QueryRow(ctx, "SELECT lease_until FROM instance_jobs WHERE id = $1", jobID).Scan(&renewedExpiry); err != nil {
		t.Fatal(err)
	}
	if !renewedExpiry.After(previousExpiry) {
		t.Fatalf("renewed lease_until = %s, want after %s", renewedExpiry, previousExpiry)
	}

	stale := lease
	stale.FencingToken++
	if err := repository.Renew(ctx, stale, 20*time.Second); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("stale Renew() error = %v, want ErrLeaseLost", err)
	}
}

func TestRecordObservationRequiresCurrentLeaseAndGeneration(t *testing.T) {
	t.Run("current lease writes complete observation", func(t *testing.T) {
		pool := openJobsTestDatabase(t)
		repository := NewPostgresRepository(pool)
		jobID := insertInspectJob(t, pool, 90)
		lease := claimOne(t, repository, "worker-a", 5*time.Second)
		observation := runningObservation()
		if err := repository.RecordObservation(context.Background(), lease, observation); err != nil {
			t.Fatalf("RecordObservation() error = %v", err)
		}

		var state string
		var generation int64
		var resourceID string
		var entrypoints json.RawMessage
		var ciphertext []byte
		var observedAt *time.Time
		var errorCode *string
		var version int64
		if err := pool.QueryRow(context.Background(), `
			SELECT observed_state::text, observed_generation, provider_resource_id,
			       entrypoints, access_ciphertext, last_observed_at,
			       last_error_code, version
			FROM instances WHERE id = $1`, instanceIDFor(90)).Scan(
			&state, &generation, &resourceID, &entrypoints, &ciphertext,
			&observedAt, &errorCode, &version,
		); err != nil {
			t.Fatal(err)
		}
		expectedEntrypoints, err := json.Marshal(observation.Entrypoints)
		if err != nil {
			t.Fatal(err)
		}
		if state != "running" || generation != 7 || resourceID != observation.ProviderResourceID || !jsonEqual(entrypoints, expectedEntrypoints) || !bytes.Equal(ciphertext, observation.AccessCiphertext) || observedAt == nil || errorCode != nil || version != 2 {
			t.Fatalf("observation state = %s/%d/%s/%s/%x/%v/%v/%d for job %s", state, generation, resourceID, entrypoints, ciphertext, observedAt, errorCode, version, jobID)
		}
	})

	t.Run("expired worker cannot overwrite reclaimed observation", func(t *testing.T) {
		pool := openJobsTestDatabase(t)
		repository := NewPostgresRepository(pool)
		insertInspectJob(t, pool, 91)
		oldLease := claimOne(t, repository, "worker-a", 5*time.Second)
		if _, err := pool.Exec(context.Background(), `
			UPDATE instance_jobs SET lease_until = clock_timestamp() - interval '1 second'
			WHERE id = $1`, string(oldLease.Job.JobID)); err != nil {
			t.Fatal(err)
		}
		if err := repository.RecordObservation(context.Background(), oldLease, runningObservation()); !errors.Is(err, ErrObservationRejected) {
			t.Fatalf("expired RecordObservation() error = %v, want ErrObservationRejected", err)
		}
		currentLease := claimOne(t, repository, "worker-b", 5*time.Second)
		currentObservation := Observation{State: ObservedStarting, ProviderResourceID: "pod/current-generation"}
		if err := repository.RecordObservation(context.Background(), currentLease, currentObservation); err != nil {
			t.Fatalf("current RecordObservation() error = %v", err)
		}
		if err := repository.RecordObservation(context.Background(), oldLease, Observation{
			State: ObservedFailed, ErrorCode: "provider.stale", ErrorSummary: "Stale worker result",
		}); !errors.Is(err, ErrObservationRejected) {
			t.Fatalf("stale RecordObservation() error = %v, want ErrObservationRejected", err)
		}
		assertObservedSummary(t, pool, instanceIDFor(91), "starting", 7, "pod/current-generation", 2)
	})

	t.Run("old generation cannot overwrite new desired state", func(t *testing.T) {
		pool := openJobsTestDatabase(t)
		repository := NewPostgresRepository(pool)
		insertInspectJob(t, pool, 92)
		lease := claimOne(t, repository, "worker-a", 5*time.Second)
		if _, err := pool.Exec(context.Background(), `
			UPDATE instances SET desired_generation = desired_generation + 1
			WHERE id = $1`, instanceIDFor(92)); err != nil {
			t.Fatal(err)
		}
		if err := repository.RecordObservation(context.Background(), lease, runningObservation()); !errors.Is(err, ErrObservationRejected) {
			t.Fatalf("old generation RecordObservation() error = %v, want ErrObservationRejected", err)
		}
		assertObservedSummary(t, pool, instanceIDFor(92), "pending", 0, "", 1)
	})
}

func TestFailureInjectionPersistsEveryJobOutcome(t *testing.T) {
	retryPolicy := RetryPolicy{InitialDelay: 2 * time.Second, MaxDelay: 5 * time.Second}
	tests := []struct {
		name          string
		index         int
		failure       Failure
		wantStatus    JobStatus
		wantOutcome   string
		wantFinished  bool
		wantErrorCode string
	}{
		{
			name:          "retryable waits",
			index:         101,
			failure:       Failure{Kind: FailureRetryable, Code: "provider.unavailable", Summary: "Provider is temporarily unavailable"},
			wantStatus:    StatusRetryWait,
			wantOutcome:   "retryable_error",
			wantFinished:  false,
			wantErrorCode: "provider.unavailable",
		},
		{
			name:          "permanent dies",
			index:         102,
			failure:       Failure{Kind: FailurePermanent, Code: "provider.image_missing", Summary: "Configured image does not exist"},
			wantStatus:    StatusDead,
			wantOutcome:   "permanent_error",
			wantFinished:  true,
			wantErrorCode: "provider.image_missing",
		},
		{
			name:          "cancelled terminates",
			index:         103,
			failure:       Failure{Kind: FailureCancelled, Code: "job.cancelled", Summary: "The requested operation was cancelled"},
			wantStatus:    StatusCancelled,
			wantOutcome:   "cancelled",
			wantFinished:  true,
			wantErrorCode: "job.cancelled",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			pool := openJobsTestDatabase(t)
			repository := NewPostgresRepository(pool)
			jobID := insertInspectJob(t, pool, test.index)
			lease := claimOne(t, repository, "worker-a", 5*time.Second)
			failedAt := time.Now()
			status, err := repository.Fail(context.Background(), lease, test.failure, retryPolicy)
			if err != nil {
				t.Fatalf("Fail() error = %v", err)
			}
			if status != test.wantStatus {
				t.Fatalf("Fail() status = %s, want %s", status, test.wantStatus)
			}

			var jobStatus string
			var availableAt time.Time
			var finishedAt *time.Time
			var errorCode *string
			if err := pool.QueryRow(context.Background(), `
				SELECT status::text, available_at, finished_at, error_code
				FROM instance_jobs WHERE id = $1`, jobID).Scan(&jobStatus, &availableAt, &finishedAt, &errorCode); err != nil {
				t.Fatal(err)
			}
			if jobStatus != string(test.wantStatus) || (finishedAt != nil) != test.wantFinished || errorCode == nil || *errorCode != test.wantErrorCode {
				t.Fatalf("job state = %s/%v/%v, want %s/finished=%v/%s", jobStatus, finishedAt, errorCode, test.wantStatus, test.wantFinished, test.wantErrorCode)
			}
			if test.wantStatus == StatusRetryWait {
				if availableAt.Before(failedAt.Add(1500*time.Millisecond)) || availableAt.After(failedAt.Add(3*time.Second)) {
					t.Fatalf("retry available_at = %s, want approximately two seconds after %s", availableAt, failedAt)
				}
			}
			assertAttempt(t, pool, jobID, 1, test.wantOutcome, test.wantErrorCode)
		})
	}
}

func TestRetryableFailureBacksOffExponentiallyThenDeadLetters(t *testing.T) {
	pool := openJobsTestDatabase(t)
	repository := NewPostgresRepository(pool)
	jobID := insertInspectJob(t, pool, 110)
	if _, err := pool.Exec(context.Background(), "UPDATE instance_jobs SET max_attempts = 3 WHERE id = $1", jobID); err != nil {
		t.Fatal(err)
	}
	failure := Failure{Kind: FailureRetryable, Code: "provider.unavailable", Summary: "Provider is temporarily unavailable"}
	policy := RetryPolicy{InitialDelay: time.Second, MaxDelay: 10 * time.Second}

	for attempt, expectedDelay := range []time.Duration{time.Second, 2 * time.Second} {
		lease := claimOne(t, repository, "worker-a", 5*time.Second)
		failedAt := time.Now()
		status, err := repository.Fail(context.Background(), lease, failure, policy)
		if err != nil || status != StatusRetryWait {
			t.Fatalf("attempt %d Fail() = %s/%v, want retry_wait", attempt+1, status, err)
		}
		var availableAt time.Time
		if err := pool.QueryRow(context.Background(), "SELECT available_at FROM instance_jobs WHERE id = $1", jobID).Scan(&availableAt); err != nil {
			t.Fatal(err)
		}
		if availableAt.Before(failedAt.Add(expectedDelay-250*time.Millisecond)) || availableAt.After(failedAt.Add(expectedDelay+time.Second)) {
			t.Fatalf("attempt %d backoff = %s from %s, want %s", attempt+1, availableAt, failedAt, expectedDelay)
		}
		if _, err := pool.Exec(context.Background(), "UPDATE instance_jobs SET available_at = clock_timestamp() - interval '1 second' WHERE id = $1", jobID); err != nil {
			t.Fatal(err)
		}
	}

	lastLease := claimOne(t, repository, "worker-b", 5*time.Second)
	status, err := repository.Fail(context.Background(), lastLease, failure, policy)
	if err != nil || status != StatusDead {
		t.Fatalf("final Fail() = %s/%v, want dead", status, err)
	}
	var attempts int
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM instance_job_attempts
		WHERE job_id = $1 AND outcome = 'retryable_error'`, jobID).Scan(&attempts); err != nil {
		t.Fatal(err)
	}
	if attempts != 3 {
		t.Fatalf("retryable attempt history = %d, want 3", attempts)
	}
}

func TestNewGenerationSupersedesLeasedAndQueuedJobs(t *testing.T) {
	t.Run("leased", func(t *testing.T) {
		pool := openJobsTestDatabase(t)
		repository := NewPostgresRepository(pool)
		jobID := insertInspectJob(t, pool, 120)
		lease := claimOne(t, repository, "worker-a", 5*time.Second)
		if _, err := pool.Exec(context.Background(), "UPDATE instances SET desired_generation = desired_generation + 1 WHERE id = $1", instanceIDFor(120)); err != nil {
			t.Fatal(err)
		}
		status, err := repository.Complete(context.Background(), lease)
		if err != nil || status != StatusSuperseded {
			t.Fatalf("Complete() = %s/%v, want superseded", status, err)
		}
		assertJobStatus(t, pool, jobID, StatusSuperseded, "job.superseded")
		assertAttempt(t, pool, jobID, 1, "cancelled", "job.superseded")
	})

	t.Run("queued", func(t *testing.T) {
		pool := openJobsTestDatabase(t)
		repository := NewPostgresRepository(pool)
		jobID := insertInspectJob(t, pool, 121)
		if _, err := pool.Exec(context.Background(), "UPDATE instances SET desired_generation = desired_generation + 1 WHERE id = $1", instanceIDFor(121)); err != nil {
			t.Fatal(err)
		}
		leases, err := repository.ClaimBatch(context.Background(), "worker-a", 1, 5*time.Second)
		if err != nil || len(leases) != 0 {
			t.Fatalf("ClaimBatch() = %d/%v, want no stale job", len(leases), err)
		}
		assertJobStatus(t, pool, jobID, StatusSuperseded, "job.superseded")
		var attempts int
		if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM instance_job_attempts WHERE job_id = $1", jobID).Scan(&attempts); err != nil {
			t.Fatal(err)
		}
		if attempts != 0 {
			t.Fatalf("queued superseded job has %d attempts, want 0", attempts)
		}
	})
}

func TestExpiredFinalAttemptMovesToDeadLetter(t *testing.T) {
	pool := openJobsTestDatabase(t)
	repository := NewPostgresRepository(pool)
	jobID := insertInspectJob(t, pool, 130)
	if _, err := pool.Exec(context.Background(), "UPDATE instance_jobs SET max_attempts = 1 WHERE id = $1", jobID); err != nil {
		t.Fatal(err)
	}
	claimOne(t, repository, "worker-a", 5*time.Second)
	if _, err := pool.Exec(context.Background(), "UPDATE instance_jobs SET lease_until = clock_timestamp() - interval '1 second' WHERE id = $1", jobID); err != nil {
		t.Fatal(err)
	}
	leases, err := repository.ClaimBatch(context.Background(), "worker-b", 1, 5*time.Second)
	if err != nil || len(leases) != 0 {
		t.Fatalf("ClaimBatch() = %d/%v, want exhausted job not reclaimed", len(leases), err)
	}
	assertJobStatus(t, pool, jobID, StatusDead, "worker.attempts_exhausted")
	assertAttempt(t, pool, jobID, 1, "lease_lost", "worker.lease_expired")
}

func TestTwoRunnersCompleteEachJobOnce(t *testing.T) {
	pool := openJobsTestDatabase(t)
	repository := &claimRecordingRepository{
		Repository: NewPostgresRepository(pool),
		claims:     make(map[string]int),
	}
	const jobCount = 24
	for index := 1; index <= jobCount; index++ {
		insertInspectJob(t, pool, index)
	}

	var mu sync.Mutex
	processed := make(map[string]int, jobCount)
	processor := processorFunc(func(_ context.Context, job contracts.InstanceJob) error {
		mu.Lock()
		processed[string(job.JobID)]++
		mu.Unlock()
		time.Sleep(15 * time.Millisecond)
		return nil
	})
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	baseConfig := RunnerConfig{
		BatchSize:        4,
		Concurrency:      4,
		LeaseDuration:    5 * time.Second,
		RenewInterval:    time.Second,
		PollInterval:     10 * time.Millisecond,
		OperationTimeout: time.Second,
	}
	firstConfig := baseConfig
	firstConfig.WorkerID = "worker-a"
	secondConfig := baseConfig
	secondConfig.WorkerID = "worker-b"

	ctx, cancel := context.WithCancel(context.Background())
	firstStopped := make(chan error, 1)
	secondStopped := make(chan error, 1)
	go func() { firstStopped <- NewRunner(repository, processor, firstConfig, logger).Run(ctx) }()
	go func() { secondStopped <- NewRunner(repository, processor, secondConfig, logger).Run(ctx) }()

	eventually(t, 10*time.Second, func() bool {
		var succeeded int
		if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM instance_jobs WHERE status = 'succeeded'").Scan(&succeeded); err != nil {
			t.Fatal(err)
		}
		return succeeded == jobCount
	})
	cancel()
	waitRunner(t, firstStopped)
	waitRunner(t, secondStopped)

	mu.Lock()
	defer mu.Unlock()
	if len(processed) != jobCount {
		t.Fatalf("processed %d jobs, want %d", len(processed), jobCount)
	}
	for jobID, count := range processed {
		if count != 1 {
			t.Fatalf("job %s processed %d times, want once", jobID, count)
		}
	}
	repository.mu.Lock()
	firstClaims := repository.claims["worker-a"]
	secondClaims := repository.claims["worker-b"]
	repository.mu.Unlock()
	if firstClaims == 0 || secondClaims == 0 {
		t.Fatalf("worker claim counts = %d/%d, want both workers to participate", firstClaims, secondClaims)
	}
	var invalidRows int
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM instance_jobs
		WHERE status <> 'succeeded' OR fencing_token <> 1 OR attempt_count <> 1`).Scan(&invalidRows); err != nil {
		t.Fatal(err)
	}
	if invalidRows != 0 {
		t.Fatalf("found %d jobs without single effective completion", invalidRows)
	}
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM instance_job_attempts
		WHERE outcome <> 'succeeded' OR finished_at IS NULL OR error_code IS NOT NULL`).Scan(&invalidRows); err != nil {
		t.Fatal(err)
	}
	if invalidRows != 0 {
		t.Fatalf("found %d invalid successful attempt records", invalidRows)
	}
}

type claimRecordingRepository struct {
	Repository
	mu     sync.Mutex
	claims map[string]int
}

func (repository *claimRecordingRepository) ClaimBatch(ctx context.Context, owner string, limit int, duration time.Duration) ([]Lease, error) {
	leases, err := repository.Repository.ClaimBatch(ctx, owner, limit, duration)
	if err == nil && len(leases) > 0 {
		repository.mu.Lock()
		repository.claims[owner] += len(leases)
		repository.mu.Unlock()
	}
	return leases, err
}

func TestRunnerGracefulStopReturnsLeaseToQueue(t *testing.T) {
	pool := openJobsTestDatabase(t)
	repository := NewPostgresRepository(pool)
	jobID := insertInspectJob(t, pool, 1)
	processorStarted := make(chan struct{})
	processor := processorFunc(func(ctx context.Context, _ contracts.InstanceJob) error {
		close(processorStarted)
		<-ctx.Done()
		return ctx.Err()
	})
	config := RunnerConfig{
		WorkerID:         "worker-a",
		BatchSize:        1,
		Concurrency:      1,
		LeaseDuration:    5 * time.Second,
		RenewInterval:    time.Second,
		PollInterval:     10 * time.Millisecond,
		OperationTimeout: time.Second,
	}
	runner := NewRunner(repository, processor, config, slog.New(slog.NewTextHandler(io.Discard, nil)))
	cancel, stopped := runRunner(t, runner)
	waitClosed(t, processorStarted, "processor start")

	eventually(t, 2*time.Second, func() bool {
		var status string
		if err := pool.QueryRow(context.Background(), "SELECT status FROM instance_jobs WHERE id = $1", jobID).Scan(&status); err != nil {
			t.Fatal(err)
		}
		return status == "leased"
	})
	cancel()
	waitRunner(t, stopped)

	var status string
	var owner *string
	var leaseUntil *time.Time
	if err := pool.QueryRow(context.Background(), "SELECT status, lease_owner, lease_until FROM instance_jobs WHERE id = $1", jobID).Scan(&status, &owner, &leaseUntil); err != nil {
		t.Fatal(err)
	}
	if status != "ready" || owner != nil || leaseUntil != nil {
		t.Fatalf("released job state = %s/%v/%v, want ready/nil/nil", status, owner, leaseUntil)
	}
	assertAttempt(t, pool, jobID, 1, "cancelled", "worker.interrupted")
}

func TestRunnerOutageReleasesLeaseAndReplacementCompletes(t *testing.T) {
	pool := openJobsTestDatabase(t)
	repository := NewPostgresRepository(pool)
	jobID := insertInspectJob(t, pool, 1)
	processorStarted := make(chan struct{})
	firstProcessor := processorFunc(func(ctx context.Context, _ contracts.InstanceJob) error {
		close(processorStarted)
		<-ctx.Done()
		return ctx.Err()
	})
	firstConfig := RunnerConfig{
		WorkerID:         "worker-before-outage",
		BatchSize:        1,
		Concurrency:      1,
		LeaseDuration:    5 * time.Second,
		RenewInterval:    time.Second,
		PollInterval:     10 * time.Millisecond,
		OperationTimeout: time.Second,
	}
	firstRunner := NewRunner(
		repository,
		firstProcessor,
		firstConfig,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	cancelFirst, firstStopped := runRunner(t, firstRunner)
	waitClosed(t, processorStarted, "processor start")

	eventually(t, 2*time.Second, func() bool {
		var status string
		if err := pool.QueryRow(context.Background(), "SELECT status FROM instance_jobs WHERE id = $1", jobID).Scan(&status); err != nil {
			t.Fatal(err)
		}
		return status == "leased"
	})
	cancelFirst()
	waitRunner(t, firstStopped)
	assertAttempt(t, pool, jobID, 1, "cancelled", "worker.interrupted")

	secondConfig := firstConfig
	secondConfig.WorkerID = "worker-after-outage"
	secondRunner := NewRunner(
		repository,
		processorFunc(func(context.Context, contracts.InstanceJob) error { return nil }),
		secondConfig,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	cancelSecond, secondStopped := runRunner(t, secondRunner)
	eventually(t, 2*time.Second, func() bool {
		var status string
		if err := pool.QueryRow(context.Background(), "SELECT status FROM instance_jobs WHERE id = $1", jobID).Scan(&status); err != nil {
			t.Fatal(err)
		}
		return status == string(StatusSucceeded)
	})
	cancelSecond()
	waitRunner(t, secondStopped)

	assertSuccessfulAttempt(t, pool, jobID, 2)
	var attemptCount int
	var owner *string
	var leaseUntil *time.Time
	if err := pool.QueryRow(context.Background(), `
		SELECT attempt_count, lease_owner, lease_until
		FROM instance_jobs WHERE id = $1`, jobID).Scan(&attemptCount, &owner, &leaseUntil); err != nil {
		t.Fatal(err)
	}
	if attemptCount != 2 || owner != nil || leaseUntil != nil {
		t.Fatalf("recovered job state = attempts:%d owner:%v lease:%v", attemptCount, owner, leaseUntil)
	}
}

func openJobsTestDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	adminURL := os.Getenv("TEST_DATABASE_ADMIN_URL")
	if adminURL == "" {
		t.Skip("TEST_DATABASE_ADMIN_URL is required for PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	adminConfig, err := pgxpool.ParseConfig(adminURL)
	if err != nil {
		t.Fatal(err)
	}
	adminPool, err := pgxpool.NewWithConfig(ctx, adminConfig)
	if err != nil {
		t.Fatal(err)
	}
	databaseName := fmt.Sprintf("sauryctf_worker_jobs_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{databaseName}.Sanitize()
	if _, err := adminPool.Exec(ctx, "CREATE DATABASE "+identifier); err != nil {
		adminPool.Close()
		t.Fatal(err)
	}

	testConfig, err := pgxpool.ParseConfig(adminURL)
	if err != nil {
		t.Fatal(err)
	}
	testConfig.ConnConfig.Database = databaseName
	pool, err := pgxpool.NewWithConfig(ctx, testConfig)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, instanceJobsTestSchema); err != nil {
		pool.Close()
		adminPool.Close()
		t.Fatal(err)
	}

	t.Cleanup(func() {
		pool.Close()
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = adminPool.Exec(cleanupContext, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, databaseName)
		_, _ = adminPool.Exec(cleanupContext, "DROP DATABASE IF EXISTS "+identifier)
		adminPool.Close()
	})
	return pool
}

func insertInspectJob(t *testing.T, pool *pgxpool.Pool, index int) string {
	t.Helper()
	fixture := loadInspectFixture(t)
	payload, err := json.Marshal(fixture.Payload)
	if err != nil {
		t.Fatal(err)
	}
	jobID := fmt.Sprintf("018f47a2-4ef8-7e2c-9c24-%012x", index)
	instanceID := instanceIDFor(index)
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO instances (id, desired_generation)
		VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, instanceID, fixture.DesiredGeneration); err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(context.Background(), `
		INSERT INTO instance_jobs (
			id, instance_id, operation, payload_version, payload,
			desired_generation, idempotency_key
		) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		jobID, instanceID, fixture.Operation, fixture.PayloadVersion, payload,
		fixture.DesiredGeneration, fmt.Sprintf("integration:inspect:%d", index),
	)
	if err != nil {
		t.Fatal(err)
	}
	return jobID
}

func instanceIDFor(index int) string {
	return fmt.Sprintf("018f47a2-4ef8-7e2c-9c24-%012x", index+0x100000)
}

func runningObservation() Observation {
	return Observation{
		State:              ObservedRunning,
		ProviderResourceID: "pod/current-generation",
		Entrypoints: []Entrypoint{{
			Name: "web", Protocol: "http", Host: "challenge.example.test", Port: 443,
			URL: "https://challenge.example.test/instance/current",
		}},
		AccessCiphertext: []byte("sealed-access-data"),
	}
}

func jsonEqual(first, second []byte) bool {
	var firstValue any
	var secondValue any
	if json.Unmarshal(first, &firstValue) != nil || json.Unmarshal(second, &secondValue) != nil {
		return false
	}
	return reflect.DeepEqual(firstValue, secondValue)
}

func assertObservedSummary(t *testing.T, pool *pgxpool.Pool, instanceID, wantState string, wantGeneration int64, wantResourceID string, wantVersion int64) {
	t.Helper()
	var state string
	var generation int64
	var resourceID *string
	var version int64
	if err := pool.QueryRow(context.Background(), `
		SELECT observed_state::text, observed_generation, provider_resource_id, version
		FROM instances WHERE id = $1`, instanceID).Scan(&state, &generation, &resourceID, &version); err != nil {
		t.Fatal(err)
	}
	actualResourceID := ""
	if resourceID != nil {
		actualResourceID = *resourceID
	}
	if state != wantState || generation != wantGeneration || actualResourceID != wantResourceID || version != wantVersion {
		t.Fatalf("observed summary = %s/%d/%s/%d, want %s/%d/%s/%d", state, generation, actualResourceID, version, wantState, wantGeneration, wantResourceID, wantVersion)
	}
}

func assertJobStatus(t *testing.T, pool *pgxpool.Pool, jobID string, wantStatus JobStatus, wantErrorCode string) {
	t.Helper()
	var status string
	var errorCode *string
	var finishedAt *time.Time
	if err := pool.QueryRow(context.Background(), `
		SELECT status::text, error_code, finished_at
		FROM instance_jobs WHERE id = $1`, jobID).Scan(&status, &errorCode, &finishedAt); err != nil {
		t.Fatal(err)
	}
	if status != string(wantStatus) || errorCode == nil || *errorCode != wantErrorCode || finishedAt == nil {
		t.Fatalf("job state = %s/%v/%v, want %s/%s/finished", status, errorCode, finishedAt, wantStatus, wantErrorCode)
	}
}

func assertAttempt(t *testing.T, pool *pgxpool.Pool, jobID string, attemptNumber int, wantOutcome, wantErrorCode string) {
	t.Helper()
	var outcome string
	var errorCode *string
	var finishedAt *time.Time
	if err := pool.QueryRow(context.Background(), `
		SELECT outcome::text, error_code, finished_at
		FROM instance_job_attempts
		WHERE job_id = $1 AND attempt_number = $2`, jobID, attemptNumber).Scan(&outcome, &errorCode, &finishedAt); err != nil {
		t.Fatal(err)
	}
	if outcome != wantOutcome || errorCode == nil || *errorCode != wantErrorCode || finishedAt == nil {
		t.Fatalf("attempt state = %s/%v/%v, want %s/%s/finished", outcome, errorCode, finishedAt, wantOutcome, wantErrorCode)
	}
}

func assertSuccessfulAttempt(t *testing.T, pool *pgxpool.Pool, jobID string, attemptNumber int) {
	t.Helper()
	var outcome string
	var errorCode *string
	var errorSummary *string
	var finishedAt *time.Time
	if err := pool.QueryRow(context.Background(), `
		SELECT outcome::text, error_code, error_summary, finished_at
		FROM instance_job_attempts
		WHERE job_id = $1 AND attempt_number = $2`, jobID, attemptNumber).Scan(&outcome, &errorCode, &errorSummary, &finishedAt); err != nil {
		t.Fatal(err)
	}
	if outcome != "succeeded" || errorCode != nil || errorSummary != nil || finishedAt == nil {
		t.Fatalf("successful attempt state = %s/%v/%v/%v", outcome, errorCode, errorSummary, finishedAt)
	}
}

func claimOne(t *testing.T, repository Repository, owner string, duration time.Duration) Lease {
	t.Helper()
	leases, err := repository.ClaimBatch(context.Background(), owner, 1, duration)
	if err != nil {
		t.Fatalf("ClaimBatch() error = %v", err)
	}
	if len(leases) != 1 {
		t.Fatalf("ClaimBatch() returned %d leases, want 1", len(leases))
	}
	return leases[0]
}

func eventually(t *testing.T, timeout time.Duration, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition did not become true before timeout")
}

const instanceJobsTestSchema = `
CREATE TYPE instance_job_status AS ENUM (
  'ready', 'leased', 'retry_wait', 'succeeded', 'dead', 'cancelled', 'superseded'
);
CREATE TYPE instance_attempt_outcome AS ENUM (
  'running', 'succeeded', 'retryable_error', 'permanent_error', 'cancelled', 'lease_lost'
);
CREATE TYPE instance_observed_state AS ENUM (
  'pending', 'starting', 'running', 'stopping', 'stopped', 'failed', 'unknown'
);
CREATE TABLE instances (
  id uuid PRIMARY KEY,
  desired_generation bigint NOT NULL,
  observed_state instance_observed_state NOT NULL DEFAULT 'pending',
  observed_generation bigint NOT NULL DEFAULT 0,
  provider_resource_id text,
  entrypoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  access_ciphertext bytea,
  last_observed_at timestamptz,
  last_error_code text,
  last_error_summary text,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE instance_jobs (
  id uuid PRIMARY KEY,
  instance_id uuid NOT NULL REFERENCES instances(id),
  operation text NOT NULL,
  payload_version integer NOT NULL,
  payload jsonb NOT NULL,
  desired_generation bigint NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status instance_job_status NOT NULL DEFAULT 'ready',
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  error_code text,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE TABLE instance_job_attempts (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES instance_jobs(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  worker_id text NOT NULL,
  fencing_token bigint NOT NULL,
  outcome instance_attempt_outcome NOT NULL DEFAULT 'running',
  error_code text,
  error_summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (job_id, attempt_number)
);`
