package docker

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers/providertest"
)

type fakeEngine struct {
	containers   map[string]Container
	pulled       []string
	created      []CreateRequest
	createdNames []string
	started      []string
	removed      []string
	nextHostPort int
}

func newFakeEngine() *fakeEngine {
	return &fakeEngine{containers: make(map[string]Container), nextHostPort: 30000}
}

func (engine *fakeEngine) Inspect(_ context.Context, name string) (Container, error) {
	container, exists := engine.containers[name]
	if !exists {
		return Container{}, ErrNotFound
	}
	return container, nil
}

func (engine *fakeEngine) PullImage(_ context.Context, image string) error {
	engine.pulled = append(engine.pulled, image)
	return nil
}

func (engine *fakeEngine) Create(_ context.Context, name string, request CreateRequest) (string, error) {
	if _, exists := engine.containers[name]; exists {
		return "", &APIError{StatusCode: 409, Message: "already exists"}
	}
	id := fmt.Sprintf("%064x", len(engine.containers)+1)
	ports := make(map[string][]PortBinding, len(request.HostConfig.PortBindings))
	for port := range request.HostConfig.PortBindings {
		engine.nextHostPort++
		ports[port] = []PortBinding{{HostIP: "0.0.0.0", HostPort: fmt.Sprint(engine.nextHostPort)}}
	}
	engine.containers[name] = Container{
		ID: id, Name: name, Image: request.Image, Environment: request.Env,
		Labels: request.Labels, PublishedPorts: ports,
	}
	engine.created = append(engine.created, request)
	engine.createdNames = append(engine.createdNames, name)
	return id, nil
}

func (engine *fakeEngine) Start(_ context.Context, name string) error {
	container, exists := engine.containers[name]
	if !exists {
		return ErrNotFound
	}
	container.Running = true
	engine.containers[name] = container
	engine.started = append(engine.started, name)
	return nil
}

func (engine *fakeEngine) Remove(_ context.Context, name string) error {
	if _, exists := engine.containers[name]; !exists {
		return ErrNotFound
	}
	delete(engine.containers, name)
	engine.removed = append(engine.removed, name)
	return nil
}

func (engine *fakeEngine) List(_ context.Context, label, value string) ([]Container, error) {
	containers := make([]Container, 0)
	for _, container := range engine.containers {
		if container.Labels[label] == value {
			containers = append(containers, container)
		}
	}
	return containers, nil
}

func TestEnsureCreatesStartsAndReusesDeterministicContainer(t *testing.T) {
	engine := newFakeEngine()
	provider, err := New(engine, "challenges.example.test")
	if err != nil {
		t.Fatal(err)
	}
	spec := dockerTestSpec()
	first, err := provider.Ensure(context.Background(), spec)
	if err != nil {
		t.Fatalf("Ensure() error = %v", err)
	}
	if first.State != jobs.ObservedRunning || len(first.Entrypoints) != 2 {
		t.Fatalf("Ensure() observation = %+v", first)
	}
	if first.Entrypoints[0].URL == "" || first.Entrypoints[1].URL != "" {
		t.Fatalf("Ensure() entrypoints = %+v", first.Entrypoints)
	}
	if len(engine.pulled) != 1 || len(engine.created) != 1 || len(engine.started) != 1 {
		t.Fatalf("pull/create/start calls = %d/%d/%d", len(engine.pulled), len(engine.created), len(engine.started))
	}
	request := engine.created[0]
	if request.Image != spec.Runtime.Image || !slices.Equal(request.Env, []string{"MODE=competition", "PORT_HINT=8080", "SAURYCTF_FLAG=flag{docker-runtime}"}) {
		t.Fatalf("create image/env = %s/%v", request.Image, request.Env)
	}
	if request.HostConfig.Memory != spec.Runtime.Resources.MemoryBytes || request.HostConfig.NanoCPUs != 500_000_000 || request.HostConfig.StorageOpt["size"] != "536870912" {
		t.Fatalf("create resource limits = %+v", request.HostConfig)
	}
	if len(request.ExposedPorts) != 2 || len(request.HostConfig.PortBindings) != 2 || request.Labels[providers.LabelTeam] != string(spec.Key.Team) || request.Labels[LabelEntrypoints] == "" {
		t.Fatalf("create ports/labels = %+v/%+v/%+v", request.ExposedPorts, request.HostConfig.PortBindings, request.Labels)
	}
	for name, value := range request.Labels {
		if strings.Contains(name, "flag{") || strings.Contains(value, "flag{") {
			t.Fatalf("Docker label exposed the Flag: %s=%s", name, value)
		}
	}
	second, err := provider.Ensure(context.Background(), spec)
	if err != nil {
		t.Fatalf("second Ensure() error = %v", err)
	}
	if second.ProviderResourceID != first.ProviderResourceID || len(engine.pulled) != 1 || len(engine.created) != 1 || len(engine.started) != 1 {
		t.Fatalf("second Ensure() duplicated resource: observation=%+v calls=%d/%d/%d", second, len(engine.pulled), len(engine.created), len(engine.started))
	}
	inspected, err := provider.Inspect(context.Background(), spec.Key)
	if err != nil || inspected.State != jobs.ObservedRunning || len(inspected.Entrypoints) != 2 {
		t.Fatalf("Inspect() = %+v/%v", inspected, err)
	}
}

func TestDockerProviderSharedDestroyContract(t *testing.T) {
	providertest.RunContract(t, dockerTestSpec().Key, func(t *testing.T) providers.Provider {
		provider, err := New(newFakeEngine(), "127.0.0.1")
		if err != nil {
			t.Fatal(err)
		}
		return provider
	})
}

func TestDestroyRefusesConflictingOwnershipAndThenConverges(t *testing.T) {
	engine := newFakeEngine()
	provider, err := New(engine, "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	key := dockerTestSpec().Key
	name, _ := key.ResourceName()
	foreign := key.Labels()
	foreign[providers.LabelTeam] = "018f47a2-4ef8-7e2c-9c24-6d68b7459999"
	engine.containers[name] = Container{ID: "foreign", Name: name, Labels: foreign}
	if _, err := provider.Destroy(context.Background(), key); err == nil {
		t.Fatal("Destroy() removed a conflicting resource")
	}
	if len(engine.removed) != 0 {
		t.Fatalf("conflicting Remove() calls = %v", engine.removed)
	}
	engine.containers[name] = Container{ID: "owned", Name: name, Labels: key.Labels()}
	first, err := provider.Destroy(context.Background(), key)
	if err != nil || first.State != jobs.ObservedStopped {
		t.Fatalf("owned Destroy() = %+v/%v", first, err)
	}
	second, err := provider.Destroy(context.Background(), key)
	if err != nil || second.State != jobs.ObservedStopped || len(engine.removed) != 1 {
		t.Fatalf("missing Destroy() = %+v/%v, removes=%v", second, err, engine.removed)
	}
}

func TestInspectMissingResourceReturnsSafeUnknownObservation(t *testing.T) {
	provider, err := New(newFakeEngine(), "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	observation, err := provider.Inspect(context.Background(), dockerTestSpec().Key)
	if err != nil || observation.State != jobs.ObservedUnknown || observation.ErrorCode != "provider.resource_missing" {
		t.Fatalf("Inspect() = %+v/%v", observation, err)
	}
}

func TestListReturnsOnlyPlatformScopedContainers(t *testing.T) {
	engine := newFakeEngine()
	provider, err := New(engine, "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	spec := dockerTestSpec()
	name, _ := spec.Key.ResourceName()
	engine.containers[name] = Container{ID: "owned", Name: name, Labels: spec.Key.Labels()}
	engine.containers["foreign"] = Container{ID: "foreign", Name: "foreign", Labels: map[string]string{providers.LabelPlatform: "other"}}
	resources, err := provider.List(context.Background(), "sauryctf")
	if err != nil || len(resources) != 1 || resources[0].ResourceID != "docker/owned" {
		t.Fatalf("List() = %+v/%v", resources, err)
	}
}

func TestPullNotFoundIsPermanentAndDoesNotExposeEngineMessage(t *testing.T) {
	engine := &failingPullEngine{fakeEngine: newFakeEngine()}
	provider, err := New(engine, "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	_, err = provider.Ensure(context.Background(), dockerTestSpec())
	failure := jobs.ClassifyFailure(err)
	if failure.Kind != jobs.FailurePermanent || failure.Code != "provider.image_missing" || errors.Is(err, nil) {
		t.Fatalf("Ensure() failure = %+v / %v", failure, err)
	}
}

type failingPullEngine struct{ *fakeEngine }

func (engine *failingPullEngine) PullImage(context.Context, string) error {
	return &APIError{StatusCode: 404, Message: "registry.internal/private detail"}
}

func dockerTestSpec() providers.InstanceSpec {
	return providers.InstanceSpec{
		Key: providers.InstanceKey{
			Platform: "sauryctf", Provider: contracts.ProviderDocker,
			Contest:    "018f47a2-4ef8-7e2c-9c24-6d68b7451021",
			Challenge:  "018f47a2-4ef8-7e2c-9c24-6d68b7451031",
			Team:       "018f47a2-4ef8-7e2c-9c24-6d68b7451051",
			Instance:   "018f47a2-4ef8-7e2c-9c24-6d68b7451001",
			Generation: 7,
		},
		Runtime: contracts.InstanceRuntimeSpec{
			Image: "registry.example.test/challenges/web@sha256:0123456789abcdef",
			Entrypoints: []contracts.InstanceEntrypointSpec{
				{Name: "web", Protocol: "http", ContainerPort: 8080},
				{Name: "shell", Protocol: "tcp", ContainerPort: 31337},
			},
			Environment: []contracts.InstanceEnvironmentVariable{{Name: "MODE", Value: "competition"}, {Name: "PORT_HINT", Value: "8080"}},
			Resources:   contracts.InstanceResourceLimits{CPUMillicores: 500, MemoryBytes: 256 * 1024 * 1024, EphemeralStorageBytes: 512 * 1024 * 1024},
			Network:     contracts.InstanceNetworkPolicy{Egress: "deny"},
		},
		SensitiveEnvironment: []providers.SensitiveEnvironmentVariable{{Name: "SAURYCTF_FLAG", Value: []byte("flag{docker-runtime}")}},
	}
}
