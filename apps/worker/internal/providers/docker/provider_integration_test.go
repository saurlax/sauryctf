package docker

import (
	"context"
	"crypto/rand"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
)

func TestProviderAgainstDockerEngine(t *testing.T) {
	endpoint := os.Getenv("TEST_DOCKER_HOST")
	if endpoint == "" {
		t.Skip("TEST_DOCKER_HOST is required for the real Docker Engine integration test")
	}
	image := os.Getenv("TEST_DOCKER_IMAGE")
	if image == "" {
		image = "nginx:alpine"
	}
	client, err := NewHTTPClient(endpoint, DefaultAPIVersion)
	if err != nil {
		t.Fatal(err)
	}
	provider, err := New(client, "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	instanceID := randomTestUUID(t)
	spec := providers.InstanceSpec{
		Key: providers.InstanceKey{
			Platform: "sauryctf-test", Provider: contracts.ProviderDocker,
			Contest: randomTestUUID(t), Challenge: randomTestUUID(t),
			Team: randomTestUUID(t), Instance: instanceID, Generation: 1,
		},
		Runtime: contracts.InstanceRuntimeSpec{
			Image:       image,
			Entrypoints: []contracts.InstanceEntrypointSpec{{Name: "web", Protocol: "http", ContainerPort: 80}},
			Environment: []contracts.InstanceEnvironmentVariable{{Name: "INTEGRATION_TEST", Value: "true"}},
			Resources:   contracts.InstanceResourceLimits{CPUMillicores: 100, MemoryBytes: 64 * 1024 * 1024, EphemeralStorageBytes: 64 * 1024 * 1024},
			Network:     contracts.InstanceNetworkPolicy{Egress: "deny"},
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	defer func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if _, cleanupErr := provider.Destroy(cleanupContext, spec.Key); cleanupErr != nil {
			t.Errorf("cleanup Destroy() error = %v", cleanupErr)
		}
	}()

	observation, err := provider.Ensure(ctx, spec)
	if err != nil {
		t.Fatalf("Ensure() error = %v", err)
	}
	if observation.State != jobs.ObservedRunning || len(observation.Entrypoints) != 1 || observation.Entrypoints[0].Port == 0 {
		t.Fatalf("Ensure() observation = %+v", observation)
	}
	// A replacement Worker may retry Ensure after the Engine created the
	// container but before the first Worker persisted its observation. The
	// deterministic identity must converge on the same single resource.
	recovered, err := provider.Ensure(ctx, spec)
	if err != nil {
		t.Fatalf("Ensure() after simulated writeback crash error = %v", err)
	}
	if recovered.State != jobs.ObservedRunning || recovered.ProviderResourceID != observation.ProviderResourceID {
		t.Fatalf("Ensure() after simulated writeback crash = %+v, want resource %s", recovered, observation.ProviderResourceID)
	}
	inspected, err := provider.Inspect(ctx, spec.Key)
	if err != nil || inspected.State != jobs.ObservedRunning || inspected.ProviderResourceID != observation.ProviderResourceID {
		t.Fatalf("Inspect() = %+v/%v", inspected, err)
	}
	resources, err := provider.List(ctx, spec.Key.Platform)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	found := false
	for _, resource := range resources {
		if resource.ResourceID == observation.ProviderResourceID {
			found = true
		}
	}
	if !found || len(resources) != 1 {
		t.Fatalf("List() after crash recovery = %+v, want only %s", resources, observation.ProviderResourceID)
	}
	if stopped, err := provider.Destroy(ctx, spec.Key); err != nil || stopped.State != jobs.ObservedStopped {
		t.Fatalf("Destroy() = %+v/%v", stopped, err)
	}
	if stopped, err := provider.Destroy(ctx, spec.Key); err != nil || stopped.State != jobs.ObservedStopped {
		t.Fatalf("second Destroy() = %+v/%v", stopped, err)
	}
}

func randomTestUUID(t *testing.T) contracts.UUID {
	t.Helper()
	var source [16]byte
	if _, err := rand.Read(source[:]); err != nil {
		t.Fatal(err)
	}
	source[6] = source[6]&0x0f | 0x40
	source[8] = source[8]&0x3f | 0x80
	return contracts.UUID(fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		source[0:4], source[4:6], source[6:8], source[8:10], source[10:16]))
}
