// Package providertest contains lifecycle tests shared by every Provider adapter.
package providertest

import (
	"context"
	"testing"

	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
)

type Factory func(*testing.T) providers.Provider

func RunContract(t *testing.T, key providers.InstanceKey, factory Factory) {
	t.Helper()
	t.Run("destroy missing resource is idempotent", func(t *testing.T) {
		implementation := factory(t)
		if implementation.Kind() != key.Provider {
			t.Fatalf("provider kind = %q, want %q", implementation.Kind(), key.Provider)
		}
		for attempt := 1; attempt <= 2; attempt++ {
			observation, err := implementation.Destroy(context.Background(), key)
			if err != nil {
				t.Fatalf("Destroy() attempt %d error = %v", attempt, err)
			}
			if observation.State != jobs.ObservedStopped || observation.ProviderResourceID != "" || len(observation.Entrypoints) != 0 || len(observation.AccessCiphertext) != 0 {
				t.Fatalf("Destroy() attempt %d observation = %+v, want converged stopped", attempt, observation)
			}
			if err := observation.Validate(); err != nil {
				t.Fatalf("Destroy() attempt %d returned invalid observation: %v", attempt, err)
			}
		}
	})
}
