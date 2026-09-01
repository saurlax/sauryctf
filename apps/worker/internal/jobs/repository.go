// Package jobs owns PostgreSQL lease coordination for instance jobs.
package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
)

var ErrLeaseLost = errors.New("instance job lease is no longer owned")

type Lease struct {
	Job          contracts.InstanceJob
	Owner        string
	FencingToken int64
	LeaseUntil   time.Time
}

type Repository interface {
	ClaimBatch(context.Context, string, int, time.Duration) ([]Lease, error)
	Renew(context.Context, Lease, time.Duration) error
	Complete(context.Context, Lease) error
	Release(context.Context, Lease) error
}

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

const claimQuery = `
WITH candidates AS (
  SELECT id
  FROM instance_jobs
  WHERE attempt_count < max_attempts
    AND (
      (status IN ('ready', 'retry_wait') AND available_at <= clock_timestamp())
      OR (status = 'leased' AND lease_until <= clock_timestamp())
    )
  ORDER BY available_at, created_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT $2
)
UPDATE instance_jobs AS job
SET status = 'leased',
    lease_owner = $1,
    lease_until = clock_timestamp() + make_interval(secs => $3),
    fencing_token = job.fencing_token + 1,
    attempt_count = job.attempt_count + 1,
    started_at = COALESCE(job.started_at, clock_timestamp()),
    finished_at = NULL
FROM candidates
WHERE job.id = candidates.id
RETURNING job.id::text, job.instance_id::text, job.operation::text,
          job.payload_version, job.payload, job.desired_generation,
          job.idempotency_key, job.fencing_token, job.lease_until`

func (repository *PostgresRepository) ClaimBatch(ctx context.Context, owner string, limit int, duration time.Duration) ([]Lease, error) {
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin instance job claim: %w", err)
	}
	defer func() { _ = transaction.Rollback(context.Background()) }()

	rows, err := transaction.Query(ctx, claimQuery, owner, limit, duration.Seconds())
	if err != nil {
		return nil, fmt.Errorf("claim instance jobs: %w", err)
	}
	defer rows.Close()

	leases := make([]Lease, 0, limit)
	for rows.Next() {
		var raw queueJob
		var lease Lease
		if err := rows.Scan(
			&raw.JobID, &raw.InstanceID, &raw.Operation, &raw.PayloadVersion,
			&raw.Payload, &raw.DesiredGeneration, &raw.IdempotencyKey,
			&lease.FencingToken, &lease.LeaseUntil,
		); err != nil {
			return nil, fmt.Errorf("scan claimed instance job: %w", err)
		}
		lease.Job, err = raw.decode()
		if err != nil {
			return nil, err
		}
		lease.Owner = owner
		leases = append(leases, lease)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read claimed instance jobs: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit instance job claim: %w", err)
	}
	return leases, nil
}

func (repository *PostgresRepository) Renew(ctx context.Context, lease Lease, duration time.Duration) error {
	result, err := repository.pool.Exec(ctx, `
UPDATE instance_jobs
SET lease_until = clock_timestamp() + make_interval(secs => $4)
WHERE id = $1 AND status = 'leased' AND lease_owner = $2
  AND fencing_token = $3 AND lease_until > clock_timestamp()`,
		string(lease.Job.JobID), lease.Owner, lease.FencingToken, duration.Seconds())
	return leaseResult("renew", result.RowsAffected(), err)
}

func (repository *PostgresRepository) Complete(ctx context.Context, lease Lease) error {
	result, err := repository.pool.Exec(ctx, `
UPDATE instance_jobs
SET status = 'succeeded', lease_owner = NULL, lease_until = NULL,
    error_code = NULL, error_summary = NULL, finished_at = clock_timestamp()
WHERE id = $1 AND status = 'leased' AND lease_owner = $2
  AND fencing_token = $3 AND lease_until > clock_timestamp()`,
		string(lease.Job.JobID), lease.Owner, lease.FencingToken)
	return leaseResult("complete", result.RowsAffected(), err)
}

func (repository *PostgresRepository) Release(ctx context.Context, lease Lease) error {
	result, err := repository.pool.Exec(ctx, `
UPDATE instance_jobs
SET status = 'ready', available_at = clock_timestamp(),
    lease_owner = NULL, lease_until = NULL, finished_at = NULL
WHERE id = $1 AND status = 'leased' AND lease_owner = $2 AND fencing_token = $3`,
		string(lease.Job.JobID), lease.Owner, lease.FencingToken)
	return leaseResult("release", result.RowsAffected(), err)
}

func leaseResult(action string, affected int64, err error) error {
	if err != nil {
		return fmt.Errorf("%s instance job lease: %w", action, err)
	}
	if affected != 1 {
		return ErrLeaseLost
	}
	return nil
}

type queueJob struct {
	JobID             string
	InstanceID        string
	Operation         string
	PayloadVersion    uint32
	Payload           json.RawMessage
	DesiredGeneration uint64
	IdempotencyKey    string
}

func (job queueJob) decode() (contracts.InstanceJob, error) {
	envelope, err := json.Marshal(struct {
		JobID             string          `json:"job_id"`
		InstanceID        string          `json:"instance_id"`
		Operation         string          `json:"operation"`
		PayloadVersion    uint32          `json:"payload_version"`
		DesiredGeneration uint64          `json:"desired_generation"`
		IdempotencyKey    string          `json:"idempotency_key"`
		Payload           json.RawMessage `json:"payload"`
	}{job.JobID, job.InstanceID, job.Operation, job.PayloadVersion, job.DesiredGeneration, job.IdempotencyKey, job.Payload})
	if err != nil {
		return contracts.InstanceJob{}, fmt.Errorf("encode claimed instance job: %w", err)
	}
	decoded, err := contracts.DecodeInstanceJob(envelope)
	if err != nil {
		return contracts.InstanceJob{}, fmt.Errorf("validate claimed instance job: %w", err)
	}
	return decoded, nil
}
