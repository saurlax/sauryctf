package docker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
)

const LabelEntrypoints = "sauryctf.io/docker-entrypoints"

type Provider struct {
	engine     Engine
	publicHost string
}

func New(engine Engine, publicHost string) (*Provider, error) {
	publicHost = strings.TrimSpace(publicHost)
	invalidColon := strings.Contains(publicHost, ":") && net.ParseIP(publicHost) == nil
	if engine == nil || publicHost == "" || len(publicHost) > 253 || strings.ContainsAny(publicHost, "/@[]") || invalidColon {
		return nil, errors.New("Docker provider requires an engine and a plain public host")
	}
	return &Provider{engine: engine, publicHost: publicHost}, nil
}

func (provider *Provider) Kind() contracts.InstanceProvider { return contracts.ProviderDocker }

func (provider *Provider) Ensure(ctx context.Context, spec providers.InstanceSpec) (jobs.Observation, error) {
	if err := spec.Validate(); err != nil || spec.Key.Provider != contracts.ProviderDocker {
		return jobs.Observation{}, jobs.PermanentError("provider.invalid_spec", "Docker instance configuration is invalid", err)
	}
	name, err := spec.Key.ResourceName()
	if err != nil {
		return jobs.Observation{}, jobs.PermanentError("provider.invalid_key", "Docker instance identity is invalid", err)
	}
	container, err := provider.engine.Inspect(ctx, name)
	if errors.Is(err, ErrNotFound) {
		container, err = provider.create(ctx, name, spec)
	} else if err != nil {
		return jobs.Observation{}, classifyEngineError("inspect", err)
	} else if err := validateOwnedContainer(container, spec.Key); err != nil {
		return jobs.Observation{}, jobs.PermanentError("provider.ownership_conflict", "A Docker resource has conflicting ownership", err)
	}
	if err != nil {
		return jobs.Observation{}, err
	}
	if !container.Running {
		if err := provider.engine.Start(ctx, name); err != nil {
			return jobs.Observation{}, classifyEngineError("start", err)
		}
		container, err = provider.engine.Inspect(ctx, name)
		if err != nil {
			return jobs.Observation{}, classifyEngineError("inspect", err)
		}
	}
	return provider.observation(spec, container)
}

func (provider *Provider) Inspect(ctx context.Context, key providers.InstanceKey) (jobs.Observation, error) {
	if err := validateDockerKey(key); err != nil {
		return jobs.Observation{}, jobs.PermanentError("provider.invalid_key", "Docker instance identity is invalid", err)
	}
	name, _ := key.ResourceName()
	container, err := provider.engine.Inspect(ctx, name)
	if errors.Is(err, ErrNotFound) {
		return jobs.Observation{State: jobs.ObservedUnknown, ErrorCode: "provider.resource_missing", ErrorSummary: "Docker resource is missing"}, nil
	}
	if err != nil {
		return jobs.Observation{}, classifyEngineError("inspect", err)
	}
	if err := validateOwnedContainer(container, key); err != nil {
		return jobs.Observation{}, jobs.PermanentError("provider.ownership_conflict", "A Docker resource has conflicting ownership", err)
	}
	return provider.observation(providers.InstanceSpec{Key: key}, container)
}

func (provider *Provider) Destroy(ctx context.Context, key providers.InstanceKey) (jobs.Observation, error) {
	if err := validateDockerKey(key); err != nil {
		return jobs.Observation{}, jobs.PermanentError("provider.invalid_key", "Docker instance identity is invalid", err)
	}
	name, _ := key.ResourceName()
	container, err := provider.engine.Inspect(ctx, name)
	if errors.Is(err, ErrNotFound) {
		return jobs.Observation{State: jobs.ObservedStopped}, nil
	}
	if err != nil {
		return jobs.Observation{}, classifyEngineError("inspect", err)
	}
	if err := validateOwnedContainer(container, key); err != nil {
		return jobs.Observation{}, jobs.PermanentError("provider.ownership_conflict", "Docker resource ownership does not permit deletion", err)
	}
	if err := provider.engine.Remove(ctx, name); err != nil && !errors.Is(err, ErrNotFound) {
		return jobs.Observation{}, classifyEngineError("remove", err)
	}
	return jobs.Observation{State: jobs.ObservedStopped}, nil
}

func (provider *Provider) List(ctx context.Context, platformID string) ([]providers.Resource, error) {
	containers, err := provider.engine.List(ctx, providers.LabelPlatform, platformID)
	if err != nil {
		return nil, classifyEngineError("list", err)
	}
	resources := make([]providers.Resource, 0, len(containers))
	for _, container := range containers {
		if container.ID == "" {
			continue
		}
		resources = append(resources, providers.Resource{
			Provider: contracts.ProviderDocker, ResourceID: dockerResourceID(container.ID), Labels: container.Labels,
		})
	}
	return resources, nil
}

func (provider *Provider) create(ctx context.Context, name string, spec providers.InstanceSpec) (Container, error) {
	if err := provider.engine.PullImage(ctx, spec.Runtime.Image); err != nil {
		return Container{}, classifyEngineError("pull", err)
	}
	request, err := createRequest(spec)
	if err != nil {
		return Container{}, jobs.PermanentError("provider.invalid_spec", "Docker entrypoint configuration is invalid", err)
	}
	if _, err := provider.engine.Create(ctx, name, request); err != nil {
		var apiError *APIError
		if !errors.As(err, &apiError) || apiError.StatusCode != http.StatusConflict {
			return Container{}, classifyEngineError("create", err)
		}
	}
	container, err := provider.engine.Inspect(ctx, name)
	if err != nil {
		return Container{}, classifyEngineError("inspect", err)
	}
	if err := validateOwnedContainer(container, spec.Key); err != nil {
		return Container{}, jobs.PermanentError("provider.ownership_conflict", "A Docker resource has conflicting ownership", err)
	}
	return container, nil
}

func createRequest(spec providers.InstanceSpec) (CreateRequest, error) {
	environment := make([]string, 0, len(spec.Runtime.Environment))
	for _, variable := range spec.Runtime.Environment {
		environment = append(environment, variable.Name+"="+variable.Value)
	}
	exposed := make(map[string]struct{}, len(spec.Runtime.Entrypoints))
	bindings := make(map[string][]PortBinding, len(spec.Runtime.Entrypoints))
	for _, entrypoint := range spec.Runtime.Entrypoints {
		port := strconv.Itoa(entrypoint.ContainerPort) + "/tcp"
		exposed[port] = struct{}{}
		bindings[port] = []PortBinding{{HostIP: "", HostPort: ""}}
	}
	encodedEntrypoints, err := json.Marshal(spec.Runtime.Entrypoints)
	if err != nil {
		return CreateRequest{}, err
	}
	labels := spec.Key.Labels()
	labels[LabelEntrypoints] = string(encodedEntrypoints)
	return CreateRequest{
		Image: spec.Runtime.Image, Env: environment, Labels: labels, ExposedPorts: exposed,
		HostConfig: HostConfig{
			Memory:       spec.Runtime.Resources.MemoryBytes,
			NanoCPUs:     spec.Runtime.Resources.CPUMillicores * 1_000_000,
			StorageOpt:   map[string]string{"size": strconv.FormatInt(spec.Runtime.Resources.EphemeralStorageBytes, 10)},
			PortBindings: bindings,
		},
	}, nil
}

func (provider *Provider) observation(spec providers.InstanceSpec, container Container) (jobs.Observation, error) {
	resourceID := dockerResourceID(container.ID)
	if !container.Running || container.Health == "starting" {
		return jobs.Observation{State: jobs.ObservedStarting, ProviderResourceID: resourceID}, nil
	}
	if container.Health == "unhealthy" {
		return jobs.Observation{
			State: jobs.ObservedFailed, ProviderResourceID: resourceID,
			ErrorCode: "provider.docker_unhealthy", ErrorSummary: "Docker container health check is failing",
		}, nil
	}
	entrypointSpecs := spec.Runtime.Entrypoints
	if entrypointSpecs == nil {
		if err := json.Unmarshal([]byte(container.Labels[LabelEntrypoints]), &entrypointSpecs); err != nil || len(entrypointSpecs) == 0 {
			return jobs.Observation{
				State: jobs.ObservedUnknown, ProviderResourceID: resourceID,
				ErrorCode: "provider.entrypoints_missing", ErrorSummary: "Docker entrypoint metadata is missing",
			}, nil
		}
		for _, entrypoint := range entrypointSpecs {
			if err := entrypoint.Validate(); err != nil {
				return jobs.Observation{}, jobs.PermanentError("provider.invalid_entrypoints", "Docker entrypoint metadata is invalid", err)
			}
		}
	}
	entrypoints := make([]jobs.Entrypoint, 0, len(entrypointSpecs))
	for _, expected := range entrypointSpecs {
		portKey := strconv.Itoa(expected.ContainerPort) + "/tcp"
		published := append([]PortBinding(nil), container.PublishedPorts[portKey]...)
		sort.Slice(published, func(left, right int) bool {
			return published[left].HostIP+published[left].HostPort < published[right].HostIP+published[right].HostPort
		})
		if len(published) == 0 || published[0].HostPort == "" {
			return jobs.Observation{State: jobs.ObservedStarting, ProviderResourceID: resourceID}, nil
		}
		port, err := strconv.Atoi(published[0].HostPort)
		if err != nil || port < 1 || port > 65535 {
			return jobs.Observation{}, jobs.RetryableError("provider.invalid_binding", "Docker published an invalid port", err)
		}
		host := publishedHost(published[0].HostIP, provider.publicHost)
		entrypoint := jobs.Entrypoint{Name: expected.Name, Protocol: expected.Protocol, Host: host, Port: port}
		if expected.Protocol == "http" {
			entrypoint.URL = "http://" + net.JoinHostPort(host, strconv.Itoa(port))
		}
		entrypoints = append(entrypoints, entrypoint)
	}
	observation := jobs.Observation{State: jobs.ObservedRunning, ProviderResourceID: resourceID, Entrypoints: entrypoints}
	if err := observation.Validate(); err != nil {
		return jobs.Observation{}, jobs.RetryableError("provider.invalid_observation", "Docker returned invalid connection information", err)
	}
	return observation, nil
}

func validateDockerKey(key providers.InstanceKey) error {
	if err := key.Validate(); err != nil {
		return err
	}
	if key.Provider != contracts.ProviderDocker {
		return errors.New("instance key does not target Docker")
	}
	return nil
}

func validateOwnedContainer(container Container, key providers.InstanceKey) error {
	parsed, err := providers.ParseInstanceKey(container.Labels, key.Platform, contracts.ProviderDocker)
	if err != nil {
		return err
	}
	if parsed != key {
		return errors.New("container ownership labels do not match the requested instance")
	}
	return nil
}

func publishedHost(bound, fallback string) string {
	bound = strings.TrimSpace(bound)
	if bound == "" || bound == "0.0.0.0" || bound == "::" {
		return fallback
	}
	return bound
}

func dockerResourceID(id string) string { return "docker/" + id }

func classifyEngineError(operation string, err error) error {
	if err == nil {
		return nil
	}
	if operation == "pull" && errors.Is(err, ErrNotFound) {
		return jobs.PermanentError("provider.image_missing", "Configured Docker image does not exist", err)
	}
	var apiError *APIError
	if errors.As(err, &apiError) {
		if operation == "pull" && apiError.StatusCode == http.StatusNotFound {
			return jobs.PermanentError("provider.image_missing", "Configured Docker image does not exist", err)
		}
		if apiError.StatusCode >= 400 && apiError.StatusCode < 500 && apiError.StatusCode != http.StatusConflict && apiError.StatusCode != http.StatusTooManyRequests {
			return jobs.PermanentError("provider.docker_rejected", "Docker rejected the instance configuration", err)
		}
	}
	return jobs.RetryableError("provider.docker_unavailable", fmt.Sprintf("Docker %s operation is temporarily unavailable", operation), err)
}
