package jobs

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
)

type Processor interface {
	// Process must stop promptly when ctx is cancelled so the runner can release
	// its fenced lease during graceful shutdown or renewal failure.
	Process(context.Context, contracts.InstanceJob) error
}

type RunnerConfig struct {
	WorkerID         string
	BatchSize        int
	Concurrency      int
	LeaseDuration    time.Duration
	RenewInterval    time.Duration
	PollInterval     time.Duration
	OperationTimeout time.Duration
}

type Runner struct {
	repository Repository
	processor  Processor
	config     RunnerConfig
	logger     *slog.Logger
}

func NewRunner(repository Repository, processor Processor, config RunnerConfig, logger *slog.Logger) *Runner {
	return &Runner{repository: repository, processor: processor, config: config, logger: logger}
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
	jobContext, cancelJob := context.WithCancel(parent)
	renewContext, cancelRenew := context.WithCancel(jobContext)
	renewed := make(chan error, 1)
	go func() {
		err := runner.renewLoop(renewContext, lease)
		if err != nil {
			cancelJob()
		}
		renewed <- err
	}()

	processError := runner.processor.Process(jobContext, lease.Job)
	cancelRenew()
	renewError := <-renewed
	cancelJob()

	operationContext, cancelOperation := context.WithTimeout(context.Background(), runner.config.OperationTimeout)
	defer cancelOperation()
	if renewError != nil || parent.Err() != nil || processError != nil {
		if err := runner.repository.Release(operationContext, lease); err != nil && !errors.Is(err, ErrLeaseLost) {
			runner.logger.Error("cannot release instance job lease", "job_id", lease.Job.JobID, "error", err)
		}
		return
	}
	if err := runner.repository.Complete(operationContext, lease); err != nil && !errors.Is(err, ErrLeaseLost) {
		runner.logger.Error("cannot complete instance job lease", "job_id", lease.Job.JobID, "error", err)
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
