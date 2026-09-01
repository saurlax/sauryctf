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
)

type Database interface {
	health.Readiness
	Close()
}

type App struct {
	config   config.Config
	database Database
	logger   *slog.Logger
}

func New(workerConfig config.Config, database Database, logger *slog.Logger) *App {
	return &App{config: workerConfig, database: database, logger: logger}
}

// Run serves only private health probes and closes all process resources during
// graceful shutdown. Job consumers are added by later OpenSpec tasks.
func (app *App) Run(ctx context.Context) error {
	defer app.database.Close()

	listener, err := net.Listen("tcp", app.config.HealthAddress)
	if err != nil {
		return fmt.Errorf("listen on worker health address: %w", err)
	}

	server := &http.Server{
		Handler:           health.NewHandler(app.database, app.config.ReadinessTimeout),
		ReadHeaderTimeout: app.config.ReadinessTimeout,
	}
	serverErrors := make(chan error, 1)
	go func() {
		serverErrors <- server.Serve(listener)
	}()

	app.logger.InfoContext(ctx, "instance worker health server started",
		"worker_id", app.config.WorkerID,
		"address", listener.Addr().String(),
	)

	select {
	case serveError := <-serverErrors:
		if serveError == nil || errors.Is(serveError, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("serve worker health endpoint: %w", serveError)
	case <-ctx.Done():
		shutdownContext, cancel := context.WithTimeout(context.Background(), app.config.ShutdownTimeout)
		defer cancel()
		if err := server.Shutdown(shutdownContext); err != nil {
			_ = server.Close()
			return fmt.Errorf("shut down worker health endpoint: %w", err)
		}
		serveError := <-serverErrors
		if serveError != nil && !errors.Is(serveError, http.ErrServerClosed) {
			return fmt.Errorf("serve worker health endpoint during shutdown: %w", serveError)
		}
		app.logger.Info("instance worker stopped", "worker_id", app.config.WorkerID)
		return nil
	}
}
