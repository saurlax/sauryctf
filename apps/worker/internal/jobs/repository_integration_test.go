package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
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
	if err := repository.Complete(ctx, first); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("stale Complete() error = %v, want ErrLeaseLost", err)
	}
	if err := repository.Complete(ctx, second); err != nil {
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
	instanceID := fmt.Sprintf("018f47a2-4ef8-7e2c-9c24-%012x", index+0x100000)
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
CREATE TABLE instance_jobs (
  id uuid PRIMARY KEY,
  instance_id uuid NOT NULL,
  operation text NOT NULL,
  payload_version integer NOT NULL,
  payload jsonb NOT NULL,
  desired_generation bigint NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ready',
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
);`
