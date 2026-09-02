package health

import (
	"context"
	"errors"
	"testing"
)

func TestReadinessGroupRequiresEveryDependency(t *testing.T) {
	providerError := errors.New("provider unavailable")
	group, err := NewReadinessGroup(readinessStub{}, readinessStub{err: providerError})
	if err != nil {
		t.Fatal(err)
	}
	if err := group.Ready(context.Background()); !errors.Is(err, providerError) {
		t.Fatalf("Ready() error = %v, want provider error", err)
	}
}
