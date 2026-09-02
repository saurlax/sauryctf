// Package app wires the private worker process lifecycle.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"

	"github.com/saurlax/sauryctf/apps/worker/internal/config"
	"github.com/saurlax/sauryctf/apps/worker/internal/health"
	"github.com/saurlax/sauryctf/apps/worker/internal/telemetry"
)

type Database interface {
	health.Readiness
	Close()
}

type Component interface {
	Run(context.Context) error
}

type App struct {
	config     config.Config
	database   Database
	logger     *slog.Logger
	telemetry  *telemetry.Worker
	components []Component
}

func New(workerConfig config.Config, database Database, logger *slog.Logger, workerTelemetry *telemetry.Worker, components ...Component) (*App, error) {
	if database == nil || logger == nil || len(components) == 0 {
		return nil, errors.New("instance worker requires database, logger, and background components")
	}
	for _, component := range components {
		if component == nil {
			return nil, errors.New("instance worker background component must not be nil")
		}
	}
	return &App{
		config: workerConfig, database: database, logger: logger, telemetry: workerTelemetry,
		components: append([]Component(nil), components...),
	}, nil
}

// Run serves only private probes while the job runner and reconciler operate in
// the background. Any unexpected component exit stops the whole process.
func (app *App) Run(ctx context.Context) error {
	defer app.database.Close()

	listener, err := net.Listen("tcp", app.config.HealthAddress)
	if err != nil {
		return fmt.Errorf("listen on worker health address: %w", err)
	}

	var metricsHandler http.Handler
	if app.telemetry != nil {
		metricsHandler = app.telemetry.MetricsHandler()
	}
	server := &http.Server{
		Handler:           health.NewHandler(app.database, app.config.ReadinessTimeout, metricsHandler),
		ReadHeaderTimeout: app.config.ReadinessTimeout,
	}
	runContext, cancelRun := context.WithCancel(ctx)
	defer cancelRun()
	type result struct {
		component string
		err       error
	}
	results := make(chan result, len(app.components)+1)
	go func() {
		results <- result{component: "health server", err: server.Serve(listener)}
	}()
	for _, component := range app.components {
		component := component
		go func() {
			results <- result{component: fmt.Sprintf("%T", component), err: component.Run(runContext)}
		}()
	}

	app.logger.InfoContext(ctx, "instance worker health server started",
		"worker_id", app.config.WorkerID,
		"address", listener.Addr().String(),
	)

	consumed := 0
	var runError error
	select {
	case <-ctx.Done():
	case stopped := <-results:
		consumed++
		if ctx.Err() != nil {
			break
		}
		if stopped.err == nil || errors.Is(stopped.err, http.ErrServerClosed) {
			runError = fmt.Errorf("instance worker component %s stopped unexpectedly", stopped.component)
		} else {
			runError = fmt.Errorf("instance worker component %s failed: %w", stopped.component, stopped.err)
		}
	}
	cancelRun()
	shutdownContext, cancelShutdown := context.WithTimeout(context.Background(), app.config.ShutdownTimeout)
	defer cancelShutdown()
	if err := server.Shutdown(shutdownContext); err != nil {
		_ = server.Close()
		if runError == nil {
			runError = fmt.Errorf("shut down worker health endpoint: %w", err)
		}
	}
	for consumed < len(app.components)+1 {
		stopped := <-results
		consumed++
		if stopped.err != nil && !errors.Is(stopped.err, http.ErrServerClosed) && !errors.Is(stopped.err, context.Canceled) && runError == nil {
			runError = fmt.Errorf("instance worker component %s failed during shutdown: %w", stopped.component, stopped.err)
		}
	}
	app.logger.Info("instance worker stopped", "worker_id", app.config.WorkerID)
	return runError
}
