package providers

import (
	"context"
	"errors"
	"fmt"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
)

type Registry struct {
	platformID string
	providers  map[contracts.InstanceProvider]Provider
	order      []contracts.InstanceProvider
}

func NewRegistry(platformID string, implementations ...Provider) (*Registry, error) {
	if !platformIDPattern.MatchString(platformID) {
		return nil, errors.New("provider registry requires a valid platform id")
	}
	registry := &Registry{platformID: platformID, providers: make(map[contracts.InstanceProvider]Provider, len(implementations))}
	for _, implementation := range implementations {
		if implementation == nil {
			return nil, errors.New("provider registry contains a nil provider")
		}
		kind := implementation.Kind()
		if err := kind.Validate(); err != nil {
			return nil, err
		}
		if _, exists := registry.providers[kind]; exists {
			return nil, fmt.Errorf("provider %q is registered more than once", kind)
		}
		registry.providers[kind] = implementation
		registry.order = append(registry.order, kind)
	}
	return registry, nil
}

func (registry *Registry) Ensure(ctx context.Context, spec InstanceSpec) (jobs.Observation, error) {
	if err := spec.Validate(); err != nil {
		return jobs.Observation{}, fmt.Errorf("validate provider ensure spec: %w", err)
	}
	implementation, err := registry.resolve(spec.Key)
	if err != nil {
		return jobs.Observation{}, err
	}
	observation, err := implementation.Ensure(ctx, spec)
	return validatedObservation("ensure", observation, err, false)
}

func (registry *Registry) Inspect(ctx context.Context, key InstanceKey) (jobs.Observation, error) {
	if err := key.Validate(); err != nil {
		return jobs.Observation{}, fmt.Errorf("validate provider inspect key: %w", err)
	}
	implementation, err := registry.resolve(key)
	if err != nil {
		return jobs.Observation{}, err
	}
	observation, err := implementation.Inspect(ctx, key)
	return validatedObservation("inspect", observation, err, false)
}

func (registry *Registry) Destroy(ctx context.Context, key InstanceKey) (jobs.Observation, error) {
	if err := key.Validate(); err != nil {
		return jobs.Observation{}, fmt.Errorf("validate provider destroy key: %w", err)
	}
	implementation, err := registry.resolve(key)
	if err != nil {
		return jobs.Observation{}, err
	}
	observation, err := implementation.Destroy(ctx, key)
	return validatedObservation("destroy", observation, err, true)
}

func validatedObservation(action string, observation jobs.Observation, providerError error, requireStopped bool) (jobs.Observation, error) {
	if providerError != nil {
		return jobs.Observation{}, providerError
	}
	if err := observation.Validate(); err != nil {
		return jobs.Observation{}, fmt.Errorf("%s provider returned an invalid observation: %w", action, err)
	}
	if requireStopped && observation.State != jobs.ObservedStopped {
		return jobs.Observation{}, fmt.Errorf("%s provider returned state %q instead of stopped", action, observation.State)
	}
	return observation, nil
}

func (registry *Registry) ListResources(ctx context.Context) ([]Resource, error) {
	resources := make([]Resource, 0)
	for _, kind := range registry.order {
		listed, err := registry.providers[kind].List(ctx, registry.platformID)
		if err != nil {
			return nil, fmt.Errorf("list %s resources: %w", kind, err)
		}
		for _, resource := range listed {
			if err := resource.Validate(); err != nil {
				return nil, fmt.Errorf("validate %s listed resource: %w", kind, err)
			}
			if resource.Provider != kind {
				return nil, fmt.Errorf("provider %q listed resource for %q", kind, resource.Provider)
			}
			resources = append(resources, resource)
		}
	}
	return resources, nil
}

func (registry *Registry) resolve(key InstanceKey) (Provider, error) {
	if key.Platform != registry.platformID {
		return nil, ErrUnmanagedResource
	}
	implementation, exists := registry.providers[key.Provider]
	if !exists {
		return nil, fmt.Errorf("%w: %s", ErrProviderNotFound, key.Provider)
	}
	return implementation, nil
}
