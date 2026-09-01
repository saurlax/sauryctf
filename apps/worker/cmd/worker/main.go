package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/saurlax/sauryctf/apps/worker/internal/app"
	"github.com/saurlax/sauryctf/apps/worker/internal/config"
	"github.com/saurlax/sauryctf/apps/worker/internal/database"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	workerConfig, err := config.Load(os.Getenv)
	if err != nil {
		logger.Error("invalid instance worker configuration", "error", err)
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

	readiness := database.NewReadiness(pool, workerConfig.ExpectedDatabaseRole)
	worker := app.New(workerConfig, &workerDatabase{Pool: pool, Readiness: readiness}, logger)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := worker.Run(ctx); err != nil {
		logger.Error("instance worker stopped with an error", "error", err)
		os.Exit(1)
	}
}

type workerDatabase struct {
	*database.Readiness
	Pool interface{ Close() }
}

func (database *workerDatabase) Close() {
	database.Pool.Close()
}
