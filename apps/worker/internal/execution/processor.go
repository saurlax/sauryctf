// Package execution turns fenced instance jobs into provider operations.
package execution

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
)

type ObservationRecorder interface {
	RecordObservation(context.Context, jobs.Lease, jobs.Observation) error
}

type Processor struct {
	platformID string
	backend    providers.Backend
	recorder   ObservationRecorder
}

func NewProcessor(platformID string, backend providers.Backend, recorder ObservationRecorder) (*Processor, error) {
	if strings.TrimSpace(platformID) == "" || backend == nil || recorder == nil {
		return nil, errors.New("instance processor requires platform id, provider backend, and observation recorder")
	}
	return &Processor{platformID: platformID, backend: backend, recorder: recorder}, nil
}

func (processor *Processor) ProcessLease(ctx context.Context, lease jobs.Lease) error {
	key, operation, err := processor.operation(lease.Job)
	if err != nil {
		return jobs.PermanentError("job.invalid_payload", "Instance job payload is invalid", err)
	}
	observation, err := operation(ctx, key)
	if err != nil {
		return err
	}
	if err := processor.recorder.RecordObservation(ctx, lease, observation); err != nil {
		return jobs.RetryableError(
			"worker.observation_rejected",
			"Instance observation could not be committed with the active lease",
			err,
		)
	}
	return nil
}

type providerOperation func(context.Context, providers.InstanceKey) (jobs.Observation, error)

func (processor *Processor) operation(job contracts.InstanceJob) (providers.InstanceKey, providerOperation, error) {
	base, runtimeSpec, desiredState, err := jobPayload(job)
	if err != nil {
		return providers.InstanceKey{}, nil, err
	}
	key := providers.InstanceKey{
		Platform: processor.platformID, Provider: base.Provider,
		Contest: base.Target.ContestID, Challenge: base.Target.ContestChallengeID,
		Team: base.Target.TeamID, Instance: job.InstanceID,
		Generation: job.DesiredGeneration,
	}
	if err := key.Validate(); err != nil {
		return providers.InstanceKey{}, nil, fmt.Errorf("validate instance key: %w", err)
	}
	expiresAt, err := parsedExpiry(base.ExpiresAt)
	if err != nil {
		return providers.InstanceKey{}, nil, err
	}
	switch job.Operation {
	case contracts.OperationEnsure:
		return key, func(ctx context.Context, key providers.InstanceKey) (jobs.Observation, error) {
			return processor.backend.Ensure(ctx, providers.InstanceSpec{Key: key, Runtime: *runtimeSpec, ExpiresAt: expiresAt})
		}, nil
	case contracts.OperationInspect:
		return key, processor.backend.Inspect, nil
	case contracts.OperationDestroy:
		return key, processor.backend.Destroy, nil
	case contracts.OperationReconcile:
		if desiredState == contracts.DesiredStateStopped {
			return key, processor.backend.Destroy, nil
		}
		return key, func(ctx context.Context, key providers.InstanceKey) (jobs.Observation, error) {
			return processor.backend.Ensure(ctx, providers.InstanceSpec{Key: key, Runtime: *runtimeSpec, ExpiresAt: expiresAt})
		}, nil
	default:
		return providers.InstanceKey{}, nil, fmt.Errorf("unsupported operation %q", job.Operation)
	}
}

func jobPayload(job contracts.InstanceJob) (contracts.InstanceJobPayloadBase, *contracts.InstanceRuntimeSpec, contracts.InstanceDesiredState, error) {
	switch payload := job.Payload.(type) {
	case *contracts.EnsureInstanceJobPayload:
		if job.Operation != contracts.OperationEnsure || payload == nil {
			return contracts.InstanceJobPayloadBase{}, nil, "", errors.New("ensure payload does not match operation")
		}
		if err := payload.Validate(); err != nil {
			return contracts.InstanceJobPayloadBase{}, nil, "", err
		}
		return payload.InstanceJobPayloadBase, &payload.Spec, contracts.DesiredStateRunning, nil
	case *contracts.InspectInstanceJobPayload:
		if job.Operation != contracts.OperationInspect || payload == nil {
			return contracts.InstanceJobPayloadBase{}, nil, "", errors.New("inspect payload does not match operation")
		}
		if err := payload.Validate(); err != nil {
			return contracts.InstanceJobPayloadBase{}, nil, "", err
		}
		return payload.InstanceJobPayloadBase, nil, "", nil
	case *contracts.DestroyInstanceJobPayload:
		if job.Operation != contracts.OperationDestroy || payload == nil {
			return contracts.InstanceJobPayloadBase{}, nil, "", errors.New("destroy payload does not match operation")
		}
		if err := payload.Validate(); err != nil {
			return contracts.InstanceJobPayloadBase{}, nil, "", err
		}
		return payload.InstanceJobPayloadBase, nil, contracts.DesiredStateStopped, nil
	case *contracts.ReconcileInstanceJobPayload:
		if job.Operation != contracts.OperationReconcile || payload == nil {
			return contracts.InstanceJobPayloadBase{}, nil, "", errors.New("reconcile payload does not match operation")
		}
		if err := payload.Validate(); err != nil {
			return contracts.InstanceJobPayloadBase{}, nil, "", err
		}
		return payload.InstanceJobPayloadBase, payload.Spec, payload.DesiredState, nil
	default:
		return contracts.InstanceJobPayloadBase{}, nil, "", fmt.Errorf("unexpected payload type %T", job.Payload)
	}
}

func parsedExpiry(value *contracts.UTCTimestamp) (*time.Time, error) {
	if value == nil {
		return nil, nil
	}
	parsed, err := value.Time()
	if err != nil {
		return nil, fmt.Errorf("parse expires_at: %w", err)
	}
	return &parsed, nil
}
