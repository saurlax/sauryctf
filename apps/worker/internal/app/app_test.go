package app

import (
	"context"
	"io"
	"log/slog"
	"net"
	"testing"
	"time"

	"github.com/saurlax/sauryctf/apps/worker/internal/config"
)

type databaseStub struct {
	closed chan struct{}
}

func (database *databaseStub) Ready(context.Context) error {
	return nil
}

func (database *databaseStub) Close() {
	close(database.closed)
}

func TestRunStopsGracefullyAndClosesDatabase(t *testing.T) {
	database := &databaseStub{closed: make(chan struct{})}
	worker := New(testConfig("127.0.0.1:0"), database, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if err := worker.Run(ctx); err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	select {
	case <-database.closed:
	case <-time.After(time.Second):
		t.Fatal("database was not closed")
	}
}

func TestRunClosesDatabaseWhenHealthAddressCannotBind(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve address: %v", err)
	}
	defer listener.Close()

	database := &databaseStub{closed: make(chan struct{})}
	worker := New(testConfig(listener.Addr().String()), database, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := worker.Run(context.Background()); err == nil {
		t.Fatal("Run() succeeded on an occupied address")
	}
	select {
	case <-database.closed:
	case <-time.After(time.Second):
		t.Fatal("database was not closed after bind failure")
	}
}

func testConfig(address string) config.Config {
	return config.Config{
		WorkerID:         "worker-test",
		HealthAddress:    address,
		ReadinessTimeout: time.Second,
		ShutdownTimeout:  time.Second,
	}
}
