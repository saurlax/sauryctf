package providers_test

import (
	"context"
	"errors"
	"testing"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers/providertest"
)

type contractProvider struct {
	kind         contracts.InstanceProvider
	destroyCalls int
	resources    []providers.Resource
}

func (provider *contractProvider) Kind() contracts.InstanceProvider { return provider.kind }
func (provider *contractProvider) Ensure(context.Context, providers.InstanceSpec) (jobs.Observation, error) {
	return jobs.Observation{State: jobs.ObservedStarting, ProviderResourceID: "created"}, nil
}
func (provider *contractProvider) Inspect(context.Context, providers.InstanceKey) (jobs.Observation, error) {
	return jobs.Observation{State: jobs.ObservedUnknown, ErrorCode: "provider.missing", ErrorSummary: "Resource is missing"}, nil
}
func (provider *contractProvider) Destroy(context.Context, providers.InstanceKey) (jobs.Observation, error) {
	provider.destroyCalls++
	return jobs.Observation{State: jobs.ObservedStopped}, nil
}
func (provider *contractProvider) List(context.Context, string) ([]providers.Resource, error) {
	return append([]providers.Resource(nil), provider.resources...), nil
}

func TestProviderLifecycleContract(t *testing.T) {
	providertest.RunContract(t, testKey(contracts.ProviderDocker, 1), func(*testing.T) providers.Provider {
		return &contractProvider{kind: contracts.ProviderDocker}
	})
}

func TestInstanceKeyProducesStableCollisionResistantResourceNameAndLabels(t *testing.T) {
	key := testKey(contracts.ProviderKubernetes, contracts.ResourceVersion(9007199254740991))
	first, err := key.ResourceName()
	if err != nil {
		t.Fatal(err)
	}
	second, err := key.ResourceName()
	if err != nil {
		t.Fatal(err)
	}
	if first != second || first != "s-0e43a1ea53-018f47a24ef87e2c9c246d68b7451001-g9007199254740991" || len(first) > 63 {
		t.Fatalf("ResourceName() = %q / %q", first, second)
	}

	parsed, err := providers.ParseInstanceKey(key.Labels(), key.Platform, key.Provider)
	if err != nil {
		t.Fatalf("ParseInstanceKey() error = %v", err)
	}
	if parsed != key {
		t.Fatalf("ParseInstanceKey() = %+v, want %+v", parsed, key)
	}
	other := key
	other.Generation--
	otherName, err := other.ResourceName()
	if err != nil {
		t.Fatal(err)
	}
	if otherName == first {
		t.Fatal("different generations produced the same resource name")
	}
	foreign := key
	foreign.Platform = "another-platform"
	foreignName, err := foreign.ResourceName()
	if err != nil {
		t.Fatal(err)
	}
	if foreignName == first {
		t.Fatal("different platforms produced the same resource name")
	}
}

func TestRegistryRoutesLifecycleAndRejectsUnknownOrCrossPlatformKeys(t *testing.T) {
	docker := &contractProvider{kind: contracts.ProviderDocker, resources: []providers.Resource{{
		Provider: contracts.ProviderDocker, ResourceID: "docker/resource", Labels: testKey(contracts.ProviderDocker, 1).Labels(),
	}}}
	registry, err := providers.NewRegistry("sauryctf", docker)
	if err != nil {
		t.Fatal(err)
	}
	key := testKey(contracts.ProviderDocker, 1)
	if _, err := registry.Destroy(context.Background(), key); err != nil {
		t.Fatalf("Destroy() error = %v", err)
	}
	if docker.destroyCalls != 1 {
		t.Fatalf("Destroy() calls = %d, want 1", docker.destroyCalls)
	}
	resources, err := registry.ListResources(context.Background())
	if err != nil || len(resources) != 1 {
		t.Fatalf("ListResources() = %v/%v", resources, err)
	}

	unknown := testKey(contracts.ProviderKubernetes, 1)
	if _, err := registry.Destroy(context.Background(), unknown); !errors.Is(err, providers.ErrProviderNotFound) {
		t.Fatalf("unknown Destroy() error = %v, want ErrProviderNotFound", err)
	}
	foreign := key
	foreign.Platform = "another-platform"
	if _, err := registry.Destroy(context.Background(), foreign); !errors.Is(err, providers.ErrUnmanagedResource) {
		t.Fatalf("foreign Destroy() error = %v, want ErrUnmanagedResource", err)
	}
}

func TestRegistryRejectsDuplicateProviderKinds(t *testing.T) {
	_, err := providers.NewRegistry("sauryctf",
		&contractProvider{kind: contracts.ProviderDocker},
		&contractProvider{kind: contracts.ProviderDocker},
	)
	if err == nil {
		t.Fatal("NewRegistry() accepted duplicate providers")
	}
}

func TestRegistryRejectsInvalidProviderObservation(t *testing.T) {
	implementation := &invalidObservationProvider{contractProvider: contractProvider{kind: contracts.ProviderDocker}}
	registry, err := providers.NewRegistry("sauryctf", implementation)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := registry.Destroy(context.Background(), testKey(contracts.ProviderDocker, 1)); err == nil {
		t.Fatal("Destroy() accepted a non-stopped provider observation")
	}
}

type invalidObservationProvider struct{ contractProvider }

func (provider *invalidObservationProvider) Destroy(context.Context, providers.InstanceKey) (jobs.Observation, error) {
	return jobs.Observation{State: jobs.ObservedStarting, ProviderResourceID: "still-running"}, nil
}

func testKey(provider contracts.InstanceProvider, generation contracts.ResourceVersion) providers.InstanceKey {
	return providers.InstanceKey{
		Platform: "sauryctf", Provider: provider,
		Contest:    "018f47a2-4ef8-7e2c-9c24-6d68b7451021",
		Challenge:  "018f47a2-4ef8-7e2c-9c24-6d68b7451031",
		Team:       "018f47a2-4ef8-7e2c-9c24-6d68b7451051",
		Instance:   "018f47a2-4ef8-7e2c-9c24-6d68b7451001",
		Generation: generation,
	}
}
