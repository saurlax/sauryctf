package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/saurlax/sauryctf/apps/worker/internal/app"
	"github.com/saurlax/sauryctf/apps/worker/internal/config"
	"github.com/saurlax/sauryctf/apps/worker/internal/database"
	"github.com/saurlax/sauryctf/apps/worker/internal/execution"
	"github.com/saurlax/sauryctf/apps/worker/internal/health"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
	"github.com/saurlax/sauryctf/apps/worker/internal/reconcile"
	"github.com/saurlax/sauryctf/apps/worker/internal/telemetry"
)

func main() {
	logger := telemetry.NewJSONLogger(os.Stdout)
	workerConfig, err := config.Load(os.Getenv)
	if err != nil {
		logger.Error("invalid instance worker configuration", "error", err)
		os.Exit(1)
	}
	backend, err := buildProviderBackend(workerConfig)
	if err != nil {
		logger.Error("cannot initialize instance providers", "error", err)
		os.Exit(1)
	}

	pool, err := database.Open(context.Background(), database.Options{
		URL:            workerConfig.DatabaseURL,
		MaxConnections: workerConfig.DatabaseMaxConnections,
		ConnectTimeout: workerConfig.DatabaseConnectTimeout,
	})
	if err != nil {
		logger.Error("cannot initialize instance worker database", "error", err)
		os.Exit(1)
	}
	observability, err := telemetry.New(context.Background(), telemetry.Options{
		ServiceName: "sauryctf-instance-worker",
		WorkerID:    workerConfig.WorkerID,
		Getenv:      os.Getenv,
	})
	if err != nil {
		pool.Close()
		logger.Error("cannot initialize instance worker telemetry", "error", err)
		os.Exit(1)
	}

	jobRepository := jobs.NewPostgresRepository(pool)
	processor, err := execution.NewProcessor(workerConfig.PlatformID, backend, jobRepository)
	if err != nil {
		pool.Close()
		shutdownTelemetry(logger, observability, workerConfig.ShutdownTimeout)
		logger.Error("cannot initialize instance job processor", "error", err)
		os.Exit(1)
	}
	runner := jobs.NewLeaseRunner(jobRepository, processor, jobs.RunnerConfig{
		WorkerID: workerConfig.WorkerID, BatchSize: workerConfig.ClaimBatchSize,
		Concurrency: workerConfig.JobConcurrency, LeaseDuration: workerConfig.LeaseDuration,
		RenewInterval: workerConfig.LeaseRenewInterval, PollInterval: workerConfig.PollInterval,
		OperationTimeout: workerConfig.OperationTimeout,
		RetryPolicy:      jobs.RetryPolicy{InitialDelay: workerConfig.RetryInitialDelay, MaxDelay: workerConfig.RetryMaxDelay},
	}, logger, observability)
	reconciler, err := reconcile.New(
		workerConfig.PlatformID,
		workerConfig.ReconcileInterval,
		reconcile.NewPostgresStore(pool),
		backend,
		logger,
		observability,
	)
	if err != nil {
		pool.Close()
		shutdownTelemetry(logger, observability, workerConfig.ShutdownTimeout)
		logger.Error("cannot initialize instance reconciler", "error", err)
		os.Exit(1)
	}
	readiness, err := health.NewReadinessGroup(
		database.NewReadiness(pool, workerConfig.ExpectedDatabaseRole),
		backendReadiness{backend: backend},
	)
	if err != nil {
		pool.Close()
		shutdownTelemetry(logger, observability, workerConfig.ShutdownTimeout)
		logger.Error("cannot initialize instance worker readiness", "error", err)
		os.Exit(1)
	}
	worker, err := app.New(
		workerConfig,
		&workerDatabase{Pool: pool, Readiness: readiness},
		logger,
		observability,
		runner,
		reconciler,
	)
	if err != nil {
		pool.Close()
		shutdownTelemetry(logger, observability, workerConfig.ShutdownTimeout)
		logger.Error("cannot initialize instance worker", "error", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := worker.Run(ctx); err != nil {
		shutdownTelemetry(logger, observability, workerConfig.ShutdownTimeout)
		logger.Error("instance worker stopped with an error", "error", err)
		os.Exit(1)
	}
	shutdownTelemetry(logger, observability, workerConfig.ShutdownTimeout)
}

func shutdownTelemetry(logger *slog.Logger, observability *telemetry.Worker, timeout time.Duration) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	if err := observability.Shutdown(ctx); err != nil {
		logger.Warn("cannot flush instance worker telemetry", "error", err)
	}
}

type workerDatabase struct {
	health.Readiness
	Pool interface{ Close() }
}

func (database *workerDatabase) Close() {
	database.Pool.Close()
}
