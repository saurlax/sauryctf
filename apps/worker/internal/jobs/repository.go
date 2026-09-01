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

type JobStatus string

const (
	StatusReady      JobStatus = "ready"
	StatusRetryWait  JobStatus = "retry_wait"
	StatusSucceeded  JobStatus = "succeeded"
	StatusDead       JobStatus = "dead"
	StatusCancelled  JobStatus = "cancelled"
	StatusSuperseded JobStatus = "superseded"
)

type AttemptOutcome string

const (
	OutcomeSucceeded      AttemptOutcome = "succeeded"
	OutcomeRetryableError AttemptOutcome = "retryable_error"
	OutcomePermanentError AttemptOutcome = "permanent_error"
	OutcomeCancelled      AttemptOutcome = "cancelled"
)

type Lease struct {
	Job           contracts.InstanceJob
	Owner         string
	FencingToken  int64
	AttemptNumber int
	LeaseUntil    time.Time
}

type Repository interface {
	ClaimBatch(context.Context, string, int, time.Duration) ([]Lease, error)
	Renew(context.Context, Lease, time.Duration) error
	Complete(context.Context, Lease) (JobStatus, error)
	Fail(context.Context, Lease, Failure, RetryPolicy) (JobStatus, error)
	Interrupt(context.Context, Lease, string) (JobStatus, error)
}

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

const markSupersededQuery = `
WITH stale AS MATERIALIZED (
  SELECT job.id, job.attempt_count
  FROM instance_jobs AS job
  JOIN instances AS instance ON instance.id = job.instance_id
  WHERE job.desired_generation <> instance.desired_generation
    AND (
      job.status IN ('ready', 'retry_wait')
      OR (job.status = 'leased' AND job.lease_until <= clock_timestamp())
    )
  FOR UPDATE OF job SKIP LOCKED
), closed_attempts AS (
  UPDATE instance_job_attempts AS attempt
  SET outcome = 'cancelled', error_code = 'job.superseded',
      error_summary = 'A newer instance generation replaced this job',
      finished_at = clock_timestamp()
  FROM stale
  WHERE attempt.job_id = stale.id
    AND attempt.attempt_number = stale.attempt_count
    AND attempt.outcome = 'running'
)
UPDATE instance_jobs AS job
SET status = 'superseded', lease_owner = NULL, lease_until = NULL,
    error_code = 'job.superseded',
    error_summary = 'A newer instance generation replaced this job',
    finished_at = clock_timestamp()
FROM stale
WHERE job.id = stale.id`

const markExhaustedQuery = `
WITH exhausted AS MATERIALIZED (
  SELECT job.id, job.attempt_count
  FROM instance_jobs AS job
  WHERE job.attempt_count >= job.max_attempts
    AND (
      job.status IN ('ready', 'retry_wait')
      OR (job.status = 'leased' AND job.lease_until <= clock_timestamp())
    )
  FOR UPDATE OF job SKIP LOCKED
), closed_attempts AS (
  UPDATE instance_job_attempts AS attempt
  SET outcome = 'lease_lost', error_code = 'worker.lease_expired',
      error_summary = 'The final attempt lease expired before completion',
      finished_at = clock_timestamp()
  FROM exhausted
  WHERE attempt.job_id = exhausted.id
    AND attempt.attempt_number = exhausted.attempt_count
    AND attempt.outcome = 'running'
)
UPDATE instance_jobs AS job
SET status = 'dead', lease_owner = NULL, lease_until = NULL,
    error_code = COALESCE(job.error_code, 'worker.attempts_exhausted'),
    error_summary = COALESCE(job.error_summary, 'The job exhausted its attempt limit'),
    finished_at = clock_timestamp()
FROM exhausted
WHERE job.id = exhausted.id`

const claimQuery = `
WITH candidates AS (
  SELECT job.id
  FROM instance_jobs AS job
  JOIN instances AS instance ON instance.id = job.instance_id
  WHERE job.attempt_count < job.max_attempts
    AND job.desired_generation = instance.desired_generation
    AND (
      (job.status IN ('ready', 'retry_wait') AND job.available_at <= clock_timestamp())
      OR (job.status = 'leased' AND job.lease_until <= clock_timestamp())
    )
  ORDER BY job.available_at, job.created_at, job.id
  FOR UPDATE OF job SKIP LOCKED
  LIMIT $2
), claimed AS (
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
  RETURNING job.id, job.instance_id, job.operation::text AS operation,
            job.payload_version, job.payload, job.desired_generation,
            job.idempotency_key, job.fencing_token, job.attempt_count,
            job.lease_until
), lost_attempts AS (
  UPDATE instance_job_attempts AS attempt
  SET outcome = 'lease_lost', error_code = 'worker.lease_expired',
      error_summary = 'The job lease expired before completion',
      finished_at = clock_timestamp()
  FROM claimed
  WHERE attempt.job_id = claimed.id AND attempt.outcome = 'running'
), created_attempts AS (
  INSERT INTO instance_job_attempts (
    id, job_id, attempt_number, worker_id, fencing_token, outcome, started_at
  )
  SELECT gen_random_uuid(), claimed.id, claimed.attempt_count, $1,
         claimed.fencing_token, 'running', clock_timestamp()
  FROM claimed
  RETURNING job_id
)
SELECT claimed.id::text, claimed.instance_id::text, claimed.operation,
       claimed.payload_version, claimed.payload, claimed.desired_generation,
       claimed.idempotency_key, claimed.fencing_token, claimed.attempt_count,
       claimed.lease_until
FROM claimed
JOIN created_attempts ON created_attempts.job_id = claimed.id`

func (repository *PostgresRepository) ClaimBatch(ctx context.Context, owner string, limit int, duration time.Duration) ([]Lease, error) {
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin instance job claim: %w", err)
	}
	defer func() { _ = transaction.Rollback(context.Background()) }()

	if _, err := transaction.Exec(ctx, markSupersededQuery); err != nil {
		return nil, fmt.Errorf("mark superseded instance jobs: %w", err)
	}
	if _, err := transaction.Exec(ctx, markExhaustedQuery); err != nil {
		return nil, fmt.Errorf("mark exhausted instance jobs: %w", err)
	}
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
			&lease.FencingToken, &lease.AttemptNumber, &lease.LeaseUntil,
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
UPDATE instance_jobs AS job
SET lease_until = clock_timestamp() + make_interval(secs => $4)
FROM instances AS instance
WHERE job.id = $1 AND instance.id = job.instance_id
  AND job.desired_generation = instance.desired_generation
  AND job.status = 'leased' AND job.lease_owner = $2
  AND job.fencing_token = $3 AND job.lease_until > clock_timestamp()`,
		string(lease.Job.JobID), lease.Owner, lease.FencingToken, duration.Seconds())
	return leaseResult("renew", result.RowsAffected(), err)
}

func (repository *PostgresRepository) Complete(ctx context.Context, lease Lease) (JobStatus, error) {
	return repository.finish(ctx, lease, func(state leasedJobState) finishPlan {
		if state.superseded {
			return supersededPlan()
		}
		return finishPlan{status: StatusSucceeded, outcome: OutcomeSucceeded}
	}, true)
}

func (repository *PostgresRepository) Fail(ctx context.Context, lease Lease, failure Failure, retryPolicy RetryPolicy) (JobStatus, error) {
	failure = normalizeFailure(failure)
	return repository.finish(ctx, lease, func(state leasedJobState) finishPlan {
		if state.superseded {
			return supersededPlan()
		}
		plan := finishPlan{errorCode: failure.Code, errorSummary: failure.Summary}
		switch failure.Kind {
		case FailureCancelled:
			plan.status = StatusCancelled
			plan.outcome = OutcomeCancelled
		case FailurePermanent:
			plan.status = StatusDead
			plan.outcome = OutcomePermanentError
		case FailureRetryable:
			plan.outcome = OutcomeRetryableError
			if state.attemptNumber >= state.maxAttempts {
				plan.status = StatusDead
			} else {
				plan.status = StatusRetryWait
				plan.retryDelay = retryPolicy.Delay(state.attemptNumber)
			}
		default:
			plan.status = StatusDead
			plan.outcome = OutcomePermanentError
			plan.errorCode = "worker.invalid_failure"
			plan.errorSummary = "Worker produced an invalid failure classification"
		}
		return plan
	}, true)
}

func (repository *PostgresRepository) Interrupt(ctx context.Context, lease Lease, reason string) (JobStatus, error) {
	if reason == "" || len(reason) > 1024 {
		reason = "Worker operation was interrupted"
	}
	return repository.finish(ctx, lease, func(state leasedJobState) finishPlan {
		if state.superseded {
			return supersededPlan()
		}
		return finishPlan{
			status:       StatusReady,
			outcome:      OutcomeCancelled,
			errorCode:    "worker.interrupted",
			errorSummary: reason,
		}
	}, false)
}

type leasedJobState struct {
	attemptNumber int
	maxAttempts   int
	superseded    bool
}

type finishPlan struct {
	status       JobStatus
	outcome      AttemptOutcome
	errorCode    string
	errorSummary string
	retryDelay   time.Duration
}

func supersededPlan() finishPlan {
	return finishPlan{
		status:       StatusSuperseded,
		outcome:      OutcomeCancelled,
		errorCode:    "job.superseded",
		errorSummary: "A newer instance generation replaced this job",
	}
}

func (repository *PostgresRepository) finish(
	ctx context.Context,
	lease Lease,
	planFor func(leasedJobState) finishPlan,
	requireUnexpired bool,
) (JobStatus, error) {
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", fmt.Errorf("begin instance job finalization: %w", err)
	}
	defer func() { _ = transaction.Rollback(context.Background()) }()

	expiryCondition := ""
	if requireUnexpired {
		expiryCondition = "AND job.lease_until > clock_timestamp()"
	}
	var state leasedJobState
	err = transaction.QueryRow(ctx, `
SELECT job.attempt_count, job.max_attempts,
       job.desired_generation <> instance.desired_generation
FROM instance_jobs AS job
JOIN instances AS instance ON instance.id = job.instance_id
WHERE job.id = $1 AND job.status = 'leased' AND job.lease_owner = $2
  AND job.fencing_token = $3 `+expiryCondition+`
FOR UPDATE OF job
FOR SHARE OF instance`, string(lease.Job.JobID), lease.Owner, lease.FencingToken).Scan(
		&state.attemptNumber,
		&state.maxAttempts,
		&state.superseded,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		_ = transaction.Rollback(ctx)
		return "", repository.recordLeaseLost(ctx, lease)
	}
	if err != nil {
		return "", fmt.Errorf("lock instance job finalization: %w", err)
	}
	if state.attemptNumber != lease.AttemptNumber {
		return "", fmt.Errorf("instance job attempt mismatch: lease=%d database=%d", lease.AttemptNumber, state.attemptNumber)
	}

	plan := planFor(state)
	jobErrorCode := any(plan.errorCode)
	jobErrorSummary := any(plan.errorSummary)
	if plan.status == StatusSucceeded || plan.status == StatusReady {
		jobErrorCode = nil
		jobErrorSummary = nil
	}
	result, err := transaction.Exec(ctx, `
UPDATE instance_jobs AS job
SET status = $2::public.instance_job_status,
    available_at = CASE
      WHEN $2::public.instance_job_status = 'retry_wait' THEN clock_timestamp() + make_interval(secs => $5)
      WHEN $2::public.instance_job_status = 'ready' THEN clock_timestamp()
      ELSE job.available_at
    END,
    lease_owner = NULL, lease_until = NULL,
    error_code = $3, error_summary = $4,
    finished_at = CASE
      WHEN $2::public.instance_job_status IN ('ready', 'retry_wait') THEN NULL
      ELSE clock_timestamp()
    END
WHERE job.id = $1`, string(lease.Job.JobID), plan.status, jobErrorCode, jobErrorSummary, plan.retryDelay.Seconds())
	if err != nil || result.RowsAffected() != 1 {
		return "", finishResult("update", result.RowsAffected(), err)
	}

	attemptErrorCode := any(plan.errorCode)
	attemptErrorSummary := any(plan.errorSummary)
	if plan.outcome == OutcomeSucceeded {
		attemptErrorCode = nil
		attemptErrorSummary = nil
	}
	result, err = transaction.Exec(ctx, `
UPDATE instance_job_attempts
SET outcome = $4, error_code = $5, error_summary = $6,
    finished_at = clock_timestamp()
WHERE job_id = $1 AND attempt_number = $2 AND fencing_token = $3
  AND outcome = 'running'`,
		string(lease.Job.JobID), lease.AttemptNumber, lease.FencingToken,
		plan.outcome, attemptErrorCode, attemptErrorSummary)
	if err != nil || result.RowsAffected() != 1 {
		return "", finishResult("update attempt", result.RowsAffected(), err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit instance job finalization: %w", err)
	}
	return plan.status, nil
}

func (repository *PostgresRepository) recordLeaseLost(ctx context.Context, lease Lease) error {
	_, err := repository.pool.Exec(ctx, `
UPDATE instance_job_attempts
SET outcome = 'lease_lost', error_code = 'worker.lease_lost',
    error_summary = 'Another worker owns the current job lease',
    finished_at = clock_timestamp()
WHERE job_id = $1 AND attempt_number = $2 AND fencing_token = $3
  AND outcome = 'running'`, string(lease.Job.JobID), lease.AttemptNumber, lease.FencingToken)
	if err != nil {
		return fmt.Errorf("record lost instance job lease: %w", err)
	}
	return ErrLeaseLost
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

func finishResult(action string, affected int64, err error) error {
	if err != nil {
		return fmt.Errorf("%s instance job finalization: %w", action, err)
	}
	if affected != 1 {
		return fmt.Errorf("%s instance job finalization affected %d rows", action, affected)
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
