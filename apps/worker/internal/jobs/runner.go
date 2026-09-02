package jobs

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/telemetry"
)

type Processor interface {
	// Process must stop promptly when ctx is cancelled so the runner can release
	// its fenced lease during graceful shutdown or renewal failure.
	Process(context.Context, contracts.InstanceJob) error
}

// LeaseProcessor receives the active fenced lease so production processors can
// persist observations without dropping the ownership token. NewRunner keeps
// the job-only adapter for focused runner tests; production wiring must use
// NewLeaseRunner.
type LeaseProcessor interface {
	ProcessLease(context.Context, Lease) error
}

type jobProcessorAdapter struct {
	next Processor
}

func (adapter jobProcessorAdapter) ProcessLease(ctx context.Context, lease Lease) error {
	return adapter.next.Process(ctx, lease.Job)
}

type RunnerConfig struct {
	WorkerID         string
	BatchSize        int
	Concurrency      int
	LeaseDuration    time.Duration
	RenewInterval    time.Duration
	PollInterval     time.Duration
	OperationTimeout time.Duration
	RetryPolicy      RetryPolicy
}

type Runner struct {
	repository Repository
	processor  LeaseProcessor
	config     RunnerConfig
	logger     *slog.Logger
	telemetry  *telemetry.Worker
}

func NewRunner(repository Repository, processor Processor, config RunnerConfig, logger *slog.Logger, instruments ...*telemetry.Worker) *Runner {
	return NewLeaseRunner(repository, jobProcessorAdapter{next: processor}, config, logger, instruments...)
}

func NewLeaseRunner(repository Repository, processor LeaseProcessor, config RunnerConfig, logger *slog.Logger, instruments ...*telemetry.Worker) *Runner {
	var workerTelemetry *telemetry.Worker
	if len(instruments) > 0 {
		workerTelemetry = instruments[0]
	}
	return &Runner{repository: repository, processor: processor, config: config, logger: logger, telemetry: workerTelemetry}
}

func (runner *Runner) Run(ctx context.Context) error {
	slots := make(chan struct{}, runner.config.Concurrency)
	var active sync.WaitGroup
	for {
		if ctx.Err() != nil {
			active.Wait()
			return nil
		}
		available := cap(slots) - len(slots)
		if available == 0 {
			if !waitFor(ctx, runner.config.PollInterval) {
				active.Wait()
				return nil
			}
			continue
		}
		limit := min(runner.config.BatchSize, available)
		leases, err := runner.repository.ClaimBatch(ctx, runner.config.WorkerID, limit, runner.config.LeaseDuration)
		if err != nil {
			if ctx.Err() == nil {
				runner.logger.WarnContext(ctx, "cannot claim instance jobs", "error", err)
			}
			if !waitFor(ctx, runner.config.PollInterval) {
				active.Wait()
				return nil
			}
			continue
		}
		for _, lease := range leases {
			slots <- struct{}{}
			active.Add(1)
			go func(claim Lease) {
				defer active.Done()
				defer func() { <-slots }()
				runner.process(ctx, claim)
			}(lease)
		}
		if len(leases) == 0 && !waitFor(ctx, runner.config.PollInterval) {
			active.Wait()
			return nil
		}
	}
}

func (runner *Runner) process(parent context.Context, lease Lease) {
	jobParent := parent
	var jobSpan *telemetry.JobSpan
	if runner.telemetry != nil {
		jobParent, jobSpan = runner.telemetry.StartJob(parent, lease.Job, runner.config.WorkerID, lease.AttemptNumber)
	}
	jobContext, cancelJob := context.WithTimeout(jobParent, runner.config.OperationTimeout)
	runner.logger.InfoContext(jobContext, "instance job started", runner.jobLogFields(lease, jobSpan, "instance.job_started", "", "")...)
	renewContext, cancelRenew := context.WithCancel(jobContext)
	renewed := make(chan error, 1)
	go func() {
		err := runner.renewLoop(renewContext, lease)
		if err != nil {
			cancelJob()
		}
		renewed <- err
	}()

	processError := runner.processor.ProcessLease(jobContext, lease)
	cancelRenew()
	renewError := <-renewed
	cancelJob()

	operationContext, cancelOperation := context.WithTimeout(context.Background(), runner.config.OperationTimeout)
	defer cancelOperation()
	if renewError != nil || parent.Err() != nil {
		reason := "Lease renewal failure interrupted the worker operation"
		errorCode := "worker.lease_renewal_failed"
		if parent.Err() != nil {
			reason = "Worker shutdown interrupted the worker operation"
			errorCode = "worker.interrupted"
		}
		status, err := runner.repository.Interrupt(operationContext, lease, reason)
		runner.logFinalizationError("interrupt", lease, err)
		outcome := string(status)
		if err != nil {
			outcome = "finalization_error"
		}
		runner.finishJob(operationContext, lease, jobSpan, outcome, errorCode)
		return
	}
	if processError != nil {
		failure := ClassifyFailure(processError)
		status, err := runner.repository.Fail(operationContext, lease, failure, runner.config.RetryPolicy)
		runner.logFinalizationError("fail", lease, err)
		outcome := string(status)
		if err != nil {
			outcome = "finalization_error"
		}
		runner.finishJob(operationContext, lease, jobSpan, outcome, failure.Code)
		return
	}
	status, err := runner.repository.Complete(operationContext, lease)
	runner.logFinalizationError("complete", lease, err)
	outcome := string(status)
	if err != nil {
		outcome = "finalization_error"
	}
	runner.finishJob(operationContext, lease, jobSpan, outcome, "")
}

func (runner *Runner) finishJob(ctx context.Context, lease Lease, jobSpan *telemetry.JobSpan, outcome, errorCode string) {
	fields := runner.jobLogFields(lease, jobSpan, "instance.job_finished", outcome, errorCode)
	if runner.telemetry != nil {
		runner.telemetry.EndJob(jobSpan, outcome, errorCode)
	}
	level := slog.LevelInfo
	if outcome == "dead" || outcome == "finalization_error" {
		level = slog.LevelError
	} else if outcome != "succeeded" && outcome != "superseded" {
		level = slog.LevelWarn
	}
	runner.logger.Log(ctx, level, "instance job finished", fields...)
}

func (runner *Runner) jobLogFields(lease Lease, jobSpan *telemetry.JobSpan, event, outcome, errorCode string) []any {
	correlation := telemetry.CorrelateJob(lease.Job)
	fields := []any{
		"event", event,
		"worker_id", runner.config.WorkerID,
		"job_id", correlation.JobID,
		"instance_id", correlation.InstanceID,
		"contest_id", correlation.ContestID,
		"challenge_id", correlation.ChallengeID,
		"participation_id", correlation.ParticipationID,
		"team_id", correlation.TeamID,
		"operation", correlation.Operation,
		"provider", correlation.Provider,
		"attempt_number", lease.AttemptNumber,
		"fencing_token", lease.FencingToken,
	}
	fields = append(fields, jobSpan.TraceFields()...)
	if outcome != "" {
		fields = append(fields, "outcome", outcome)
	}
	if errorCode != "" {
		fields = append(fields, "error_code", errorCode)
	}
	return fields
}

func (runner *Runner) logFinalizationError(action string, lease Lease, err error) {
	if err != nil && !errors.Is(err, ErrLeaseLost) {
		runner.logger.Error("cannot finalize instance job lease",
			"action", action,
			"job_id", lease.Job.JobID,
			"attempt", lease.AttemptNumber,
			"error", err,
		)
	}
}

func (runner *Runner) renewLoop(ctx context.Context, lease Lease) error {
	ticker := time.NewTicker(runner.config.RenewInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if err := runner.repository.Renew(ctx, lease, runner.config.LeaseDuration); err != nil {
				if ctx.Err() != nil {
					return nil
				}
				return err
			}
		}
	}
}

func waitFor(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
