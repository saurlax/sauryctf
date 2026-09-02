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

type componentStub struct {
	started chan struct{}
}

func (component *componentStub) Run(ctx context.Context) error {
	close(component.started)
	<-ctx.Done()
	return nil
}

func (database *databaseStub) Ready(context.Context) error {
	return nil
}

func (database *databaseStub) Close() {
	close(database.closed)
}

func TestRunStopsGracefullyAndClosesDatabase(t *testing.T) {
	database := &databaseStub{closed: make(chan struct{})}
	component := &componentStub{started: make(chan struct{})}
	worker, err := New(testConfig("127.0.0.1:0"), database, slog.New(slog.NewTextHandler(io.Discard, nil)), nil, component)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan error, 1)
	go func() { stopped <- worker.Run(ctx) }()
	select {
	case <-component.started:
	case <-time.After(time.Second):
		t.Fatal("background component did not start")
	}
	cancel()

	if err := <-stopped; err != nil {
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
	worker, err := New(testConfig(listener.Addr().String()), database, slog.New(slog.NewTextHandler(io.Discard, nil)), nil, &componentStub{started: make(chan struct{})})
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.Run(context.Background()); err == nil {
		t.Fatal("Run() succeeded on an occupied address")
	}
	select {
	case <-database.closed:
	case <-time.After(time.Second):
		t.Fatal("database was not closed after bind failure")
	}
}

func TestNewRejectsHealthOnlyWorker(t *testing.T) {
	database := &databaseStub{closed: make(chan struct{})}
	if _, err := New(testConfig("127.0.0.1:0"), database, slog.New(slog.NewTextHandler(io.Discard, nil)), nil); err == nil {
		t.Fatal("New() accepted a worker without job or reconciliation components")
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
