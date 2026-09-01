package reconcile

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
)

type DesiredInstance struct {
	ID                 contracts.UUID
	Provider           contracts.InstanceProvider
	DesiredState       contracts.InstanceDesiredState
	DesiredGeneration  contracts.ResourceVersion
	ObservedState      jobs.ObservedState
	ObservedGeneration uint64
	ExpiresAt          *time.Time
	ProviderResourceID string
	ContestID          contracts.UUID
	ChallengeID        contracts.UUID
	ParticipationID    contracts.UUID
	TeamID             contracts.UUID
	RuntimeSpec        *contracts.InstanceRuntimeSpec
}

func (instance DesiredInstance) ownership(platformID string) Ownership {
	return Ownership{
		Platform: platformID, Provider: instance.Provider, Contest: instance.ContestID, Challenge: instance.ChallengeID,
		Team: instance.TeamID, Instance: instance.ID, Generation: instance.DesiredGeneration,
	}
}

func (instance DesiredInstance) shouldStop(now time.Time) bool {
	return instance.DesiredState == contracts.DesiredStateStopped || instance.ExpiresAt != nil && !instance.ExpiresAt.After(now)
}

func (instance DesiredInstance) validate() error {
	for name, value := range map[string]contracts.UUID{
		"id": instance.ID, "contest_id": instance.ContestID,
		"challenge_id": instance.ChallengeID, "participation_id": instance.ParticipationID,
		"team_id": instance.TeamID,
	} {
		if err := value.Validate(); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}
	if err := instance.Provider.Validate(); err != nil {
		return err
	}
	if instance.DesiredState != contracts.DesiredStateRunning && instance.DesiredState != contracts.DesiredStateStopped {
		return fmt.Errorf("unknown desired state %q", instance.DesiredState)
	}
	if err := instance.DesiredGeneration.Validate(); err != nil {
		return err
	}
	if instance.ObservedGeneration > uint64(instance.DesiredGeneration) {
		return errors.New("observed generation is ahead of desired generation")
	}
	if instance.DesiredState == contracts.DesiredStateRunning {
		if instance.RuntimeSpec == nil {
			return errors.New("running desired instance requires a runtime spec")
		}
		if err := instance.RuntimeSpec.Validate(); err != nil {
			return fmt.Errorf("runtime spec: %w", err)
		}
	}
	if len(instance.ProviderResourceID) > 255 || strings.TrimSpace(instance.ProviderResourceID) != instance.ProviderResourceID {
		return errors.New("provider resource id must contain at most 255 trimmed characters")
	}
	return nil
}

type Resource = providers.Resource

type OrphanReason string

const (
	OrphanUnknownInstance   OrphanReason = "unknown_instance"
	OrphanIdentityMismatch  OrphanReason = "identity_mismatch"
	OrphanProviderMismatch  OrphanReason = "provider_mismatch"
	OrphanFutureGeneration  OrphanReason = "future_generation"
	OrphanDuplicateIdentity OrphanReason = "duplicate_identity"
)

type OrphanReport struct {
	Resource  Resource
	Ownership Ownership
	Reason    OrphanReason
}

type Store interface {
	ListDesiredInstances(context.Context) ([]DesiredInstance, error)
	RecordObservation(context.Context, DesiredInstance, string, jobs.Observation) error
	ReportOrphan(context.Context, OrphanReport) error
}

type Result struct {
	Desired   int
	Resources int
	Ensured   int
	Inspected int
	Destroyed int
	Orphans   int
	Unmanaged int
	Failures  int
}

type Reconciler struct {
	platformID string
	interval   time.Duration
	store      Store
	backend    providers.Backend
	logger     *slog.Logger
	now        func() time.Time
}

func New(platformID string, interval time.Duration, store Store, backend providers.Backend, logger *slog.Logger) (*Reconciler, error) {
	if platformID == "" || interval <= 0 || store == nil || backend == nil || logger == nil {
		return nil, errors.New("reconciler requires platform id, positive interval, store, backend, and logger")
	}
	return &Reconciler{platformID: platformID, interval: interval, store: store, backend: backend, logger: logger, now: time.Now}, nil
}

func (reconciler *Reconciler) Run(ctx context.Context) error {
	reconciler.runCycle(ctx)
	ticker := time.NewTicker(reconciler.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			reconciler.runCycle(ctx)
		}
	}
}

func (reconciler *Reconciler) runCycle(ctx context.Context) {
	result, err := reconciler.Cycle(ctx)
	if err != nil {
		reconciler.logger.WarnContext(ctx, "instance reconciliation completed with failures", "failures", result.Failures, "error", err)
		return
	}
	reconciler.logger.InfoContext(ctx, "instance reconciliation completed",
		"desired", result.Desired, "resources", result.Resources,
		"ensured", result.Ensured, "inspected", result.Inspected,
		"destroyed", result.Destroyed, "orphans", result.Orphans,
		"unmanaged", result.Unmanaged,
	)
}

type managedResource struct {
	resource  Resource
	ownership Ownership
}

func (reconciler *Reconciler) Cycle(ctx context.Context) (Result, error) {
	result := Result{}
	desired, err := reconciler.store.ListDesiredInstances(ctx)
	if err != nil {
		return result, fmt.Errorf("list desired instances: %w", err)
	}
	resources, err := reconciler.backend.ListResources(ctx)
	if err != nil {
		return result, fmt.Errorf("list provider resources: %w", err)
	}
	result.Desired, result.Resources = len(desired), len(resources)
	cycleTime := reconciler.now()
	desiredByID := make(map[contracts.UUID]DesiredInstance, len(desired))
	for _, instance := range desired {
		if err := instance.validate(); err != nil {
			return result, fmt.Errorf("validate desired instance %q: %w", instance.ID, err)
		}
		desiredByID[instance.ID] = instance
	}

	managed := make([]managedResource, 0, len(resources))
	identityCounts := make(map[string]int)
	for _, resource := range resources {
		if err := resource.Validate(); err != nil {
			result.Unmanaged++
			reconciler.warnUnmanaged(resource, err)
			continue
		}
		ownership, err := ParseOwnership(resource.Labels, reconciler.platformID, resource.Provider)
		if err != nil {
			result.Unmanaged++
			reconciler.warnUnmanaged(resource, err)
			continue
		}
		managed = append(managed, managedResource{resource: resource, ownership: ownership})
		identityCounts[ownership.identityKey()]++
	}

	handled := make(map[contracts.UUID]bool, len(desired))
	blocked := make(map[contracts.UUID]bool, len(desired))
	var failures []error
	for _, candidate := range managed {
		instance, exists := desiredByID[candidate.ownership.Instance]
		if !exists {
			failures = reconciler.report(ctx, &result, failures, candidate, OrphanUnknownInstance)
			continue
		}
		if identityCounts[candidate.ownership.identityKey()] > 1 {
			blocked[instance.ID] = true
			failures = reconciler.report(ctx, &result, failures, candidate, OrphanDuplicateIdentity)
			continue
		}
		if candidate.resource.Provider != instance.Provider {
			blocked[instance.ID] = true
			failures = reconciler.report(ctx, &result, failures, candidate, OrphanProviderMismatch)
			continue
		}
		expected := instance.ownership(reconciler.platformID)
		if candidate.ownership.Contest != expected.Contest || candidate.ownership.Challenge != expected.Challenge || candidate.ownership.Team != expected.Team {
			blocked[instance.ID] = true
			failures = reconciler.report(ctx, &result, failures, candidate, OrphanIdentityMismatch)
			continue
		}
		if candidate.ownership.Generation > instance.DesiredGeneration {
			blocked[instance.ID] = true
			failures = reconciler.report(ctx, &result, failures, candidate, OrphanFutureGeneration)
			continue
		}
		if candidate.ownership.Generation < instance.DesiredGeneration {
			observation, destroyErr := reconciler.backend.Destroy(ctx, providers.InstanceKey(candidate.ownership))
			if destroyErr != nil {
				failures = append(failures, fmt.Errorf("destroy stale resource %s: %w", candidate.resource.ResourceID, destroyErr))
				result.Failures++
			} else if observation.State != jobs.ObservedStopped {
				failures = append(failures, fmt.Errorf("destroy stale resource %s returned state %q", candidate.resource.ResourceID, observation.State))
				result.Failures++
			} else {
				result.Destroyed++
			}
			continue
		}

		handled[instance.ID] = true
		if instance.shouldStop(cycleTime) {
			observation, destroyErr := reconciler.backend.Destroy(ctx, providers.InstanceKey(candidate.ownership))
			if destroyErr != nil {
				failures = append(failures, fmt.Errorf("destroy resource %s: %w", candidate.resource.ResourceID, destroyErr))
				result.Failures++
				continue
			}
			if observation.State != jobs.ObservedStopped {
				failures = append(failures, fmt.Errorf("destroy resource %s returned state %q", candidate.resource.ResourceID, observation.State))
				result.Failures++
				continue
			}
			if err := reconciler.store.RecordObservation(ctx, instance, candidate.resource.ResourceID, observation); err != nil {
				failures = append(failures, fmt.Errorf("record destroyed resource %s: %w", candidate.resource.ResourceID, err))
				result.Failures++
				continue
			}
			result.Destroyed++
			continue
		}
		observation, inspectErr := reconciler.backend.Inspect(ctx, providers.InstanceKey(candidate.ownership))
		if inspectErr != nil {
			failures = append(failures, fmt.Errorf("inspect resource %s: %w", candidate.resource.ResourceID, inspectErr))
			result.Failures++
			continue
		}
		if err := reconciler.store.RecordObservation(ctx, instance, candidate.resource.ResourceID, observation); err != nil {
			failures = append(failures, fmt.Errorf("record inspected resource %s: %w", candidate.resource.ResourceID, err))
			result.Failures++
			continue
		}
		result.Inspected++
	}

	for _, instance := range desired {
		if handled[instance.ID] || blocked[instance.ID] {
			continue
		}
		if instance.shouldStop(cycleTime) {
			if instance.ObservedState == jobs.ObservedStopped && instance.ObservedGeneration == uint64(instance.DesiredGeneration) && instance.ProviderResourceID == "" {
				continue
			}
			if err := reconciler.store.RecordObservation(ctx, instance, instance.ProviderResourceID, jobs.Observation{State: jobs.ObservedStopped}); err != nil {
				failures = append(failures, fmt.Errorf("record absent stopped instance %s: %w", instance.ID, err))
				result.Failures++
			}
			continue
		}
		observation, ensureErr := reconciler.backend.Ensure(ctx, providers.InstanceSpec{
			Key:       providers.InstanceKey(instance.ownership(reconciler.platformID)),
			Runtime:   *instance.RuntimeSpec,
			ExpiresAt: instance.ExpiresAt,
		})
		if ensureErr != nil {
			failures = append(failures, fmt.Errorf("ensure instance %s: %w", instance.ID, ensureErr))
			result.Failures++
			continue
		}
		if err := reconciler.store.RecordObservation(ctx, instance, instance.ProviderResourceID, observation); err != nil {
			failures = append(failures, fmt.Errorf("record ensured instance %s: %w", instance.ID, err))
			result.Failures++
			continue
		}
		result.Ensured++
	}
	return result, errors.Join(failures...)
}

func (reconciler *Reconciler) report(ctx context.Context, result *Result, failures []error, candidate managedResource, reason OrphanReason) []error {
	if err := reconciler.store.ReportOrphan(ctx, OrphanReport{Resource: candidate.resource, Ownership: candidate.ownership, Reason: reason}); err != nil {
		result.Failures++
		return append(failures, fmt.Errorf("report orphan resource %s: %w", candidate.resource.ResourceID, err))
	}
	result.Orphans++
	return failures
}

func (reconciler *Reconciler) warnUnmanaged(resource Resource, err error) {
	reconciler.logger.Warn("provider resource is outside safe reconciliation scope",
		"provider", resource.Provider, "resource_id", resource.ResourceID, "reason", err,
	)
}
