package reconcile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
)

var ErrObservationConflict = errors.New("reconciled observation no longer matches authoritative instance state")

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore {
	return &PostgresStore{pool: pool}
}

func (store *PostgresStore) ListDesiredInstances(ctx context.Context) ([]DesiredInstance, error) {
	rows, err := store.pool.Query(ctx, `
SELECT instance.id::text, instance.provider::text, instance.desired_state::text,
       instance.desired_generation, instance.observed_state::text,
       instance.observed_generation, instance.expires_at,
       COALESCE(instance.provider_resource_id, ''), instance.contest_id::text,
       instance.contest_challenge_id::text, instance.participation_id::text,
       COALESCE(target.operation, ''), COALESCE(target.payload, '{}'::jsonb)
FROM instances AS instance
LEFT JOIN LATERAL (
  SELECT job.operation::text AS operation, job.payload
  FROM instance_jobs AS job
  WHERE job.instance_id = instance.id
    AND job.desired_generation = instance.desired_generation
  ORDER BY CASE job.operation WHEN 'ensure' THEN 0 WHEN 'reconcile' THEN 1 ELSE 2 END,
           job.created_at DESC, job.id
  LIMIT 1
) AS target ON true
ORDER BY instance.id`)
	if err != nil {
		return nil, fmt.Errorf("query desired instances: %w", err)
	}
	defer rows.Close()

	instances := make([]DesiredInstance, 0)
	for rows.Next() {
		var instance DesiredInstance
		var provider, desiredState, observedState, operation string
		var payload json.RawMessage
		if err := rows.Scan(
			&instance.ID, &provider, &desiredState, &instance.DesiredGeneration,
			&observedState, &instance.ObservedGeneration, &instance.ExpiresAt,
			&instance.ProviderResourceID, &instance.ContestID, &instance.ChallengeID,
			&instance.ParticipationID, &operation, &payload,
		); err != nil {
			return nil, fmt.Errorf("scan desired instance: %w", err)
		}
		instance.Provider = contracts.InstanceProvider(provider)
		instance.DesiredState = contracts.InstanceDesiredState(desiredState)
		instance.ObservedState = jobs.ObservedState(observedState)
		base, runtimeSpec, err := decodeDesiredPayload(contracts.InstanceJobOperation(operation), payload)
		if err != nil {
			return nil, fmt.Errorf("decode desired instance %s job payload: %w", instance.ID, err)
		}
		if base.Provider != instance.Provider || base.Target.ContestID != instance.ContestID || base.Target.ContestChallengeID != instance.ChallengeID || base.Target.ParticipationID != instance.ParticipationID {
			return nil, fmt.Errorf("desired instance %s job target does not match authoritative row", instance.ID)
		}
		instance.TeamID = base.Target.TeamID
		instance.RuntimeSpec = runtimeSpec
		if err := instance.validate(); err != nil {
			return nil, fmt.Errorf("validate desired instance %s: %w", instance.ID, err)
		}
		instances = append(instances, instance)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read desired instances: %w", err)
	}
	return instances, nil
}

func decodeDesiredPayload(operation contracts.InstanceJobOperation, raw json.RawMessage) (contracts.InstanceJobPayloadBase, *contracts.InstanceRuntimeSpec, error) {
	switch operation {
	case contracts.OperationEnsure:
		var payload contracts.EnsureInstanceJobPayload
		if err := json.Unmarshal(raw, &payload); err != nil {
			return contracts.InstanceJobPayloadBase{}, nil, err
		}
		if err := payload.Validate(); err != nil {
			return contracts.InstanceJobPayloadBase{}, nil, err
		}
		return payload.InstanceJobPayloadBase, &payload.Spec, nil
	case contracts.OperationInspect:
		var payload contracts.InspectInstanceJobPayload
		if err := json.Unmarshal(raw, &payload); err != nil {
			return contracts.InstanceJobPayloadBase{}, nil, err
		}
		if err := payload.Validate(); err != nil {
			return contracts.InstanceJobPayloadBase{}, nil, err
		}
		return payload.InstanceJobPayloadBase, nil, nil
	case contracts.OperationDestroy:
		var payload contracts.DestroyInstanceJobPayload
		if err := json.Unmarshal(raw, &payload); err != nil {
			return contracts.InstanceJobPayloadBase{}, nil, err
		}
		if err := payload.Validate(); err != nil {
			return contracts.InstanceJobPayloadBase{}, nil, err
		}
		return payload.InstanceJobPayloadBase, nil, nil
	case contracts.OperationReconcile:
		var payload contracts.ReconcileInstanceJobPayload
		if err := json.Unmarshal(raw, &payload); err != nil {
			return contracts.InstanceJobPayloadBase{}, nil, err
		}
		if err := payload.Validate(); err != nil {
			return contracts.InstanceJobPayloadBase{}, nil, err
		}
		return payload.InstanceJobPayloadBase, payload.Spec, nil
	default:
		return contracts.InstanceJobPayloadBase{}, nil, fmt.Errorf("unknown operation %q", operation)
	}
}

func (store *PostgresStore) RecordObservation(ctx context.Context, instance DesiredInstance, expectedResourceID string, observation jobs.Observation) error {
	if err := instance.validate(); err != nil {
		return fmt.Errorf("validate desired instance: %w", err)
	}
	if err := observation.Validate(); err != nil {
		return fmt.Errorf("validate reconciled observation: %w", err)
	}
	if len(expectedResourceID) > 255 || strings.TrimSpace(expectedResourceID) != expectedResourceID {
		return errors.New("expected resource id must contain at most 255 trimmed characters")
	}
	entrypoints, err := json.Marshal(observation.Entrypoints)
	if err != nil {
		return fmt.Errorf("encode reconciled entrypoints: %w", err)
	}
	result, err := store.pool.Exec(ctx, `
UPDATE instances
SET observed_state = $4::public.instance_observed_state,
    observed_generation = $2,
    provider_resource_id = NULLIF($5, ''),
    entrypoints = $6,
    access_ciphertext = $7,
    last_observed_at = clock_timestamp(),
    last_error_code = NULLIF($8, ''),
    last_error_summary = NULLIF($9, ''),
    version = version + 1,
    updated_at = clock_timestamp()
WHERE id = $1 AND desired_generation = $2
  AND (provider_resource_id IS NULL OR provider_resource_id = NULLIF($3, ''))`,
		string(instance.ID), int64(instance.DesiredGeneration), expectedResourceID,
		observation.State, observation.ProviderResourceID, entrypoints,
		nilIfEmptyBytes(observation.AccessCiphertext), observation.ErrorCode,
		observation.ErrorSummary,
	)
	if err != nil {
		return fmt.Errorf("record reconciled observation: %w", err)
	}
	if result.RowsAffected() != 1 {
		return ErrObservationConflict
	}
	return nil
}

func (store *PostgresStore) ReportOrphan(ctx context.Context, report OrphanReport) error {
	if err := report.Resource.Validate(); err != nil {
		return fmt.Errorf("validate orphan resource: %w", err)
	}
	if report.Ownership.Provider != report.Resource.Provider {
		return errors.New("orphan ownership provider does not match resource provider")
	}
	if _, err := ParseOwnership(report.Ownership.Labels(), report.Ownership.Platform, report.Resource.Provider); err != nil {
		return fmt.Errorf("validate orphan ownership: %w", err)
	}
	switch report.Reason {
	case OrphanUnknownInstance, OrphanIdentityMismatch, OrphanProviderMismatch, OrphanFutureGeneration, OrphanDuplicateIdentity:
	default:
		return fmt.Errorf("unknown orphan reason %q", report.Reason)
	}
	labels, err := json.Marshal(report.Ownership.Labels())
	if err != nil {
		return fmt.Errorf("encode orphan ownership labels: %w", err)
	}
	_, err = store.pool.Exec(ctx, `
INSERT INTO instance_orphan_reports (
  provider, provider_resource_id, claimed_instance_id, claimed_generation,
  reason, ownership_labels
) VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (provider, provider_resource_id) DO UPDATE
SET claimed_instance_id = EXCLUDED.claimed_instance_id,
    claimed_generation = EXCLUDED.claimed_generation,
    reason = EXCLUDED.reason,
    ownership_labels = EXCLUDED.ownership_labels,
    occurrences = instance_orphan_reports.occurrences + 1,
    last_seen_at = clock_timestamp(),
    resolved_at = NULL`,
		report.Resource.Provider, report.Resource.ResourceID,
		string(report.Ownership.Instance), int64(report.Ownership.Generation),
		report.Reason, labels,
	)
	if err != nil {
		return fmt.Errorf("persist orphan report: %w", err)
	}
	return nil
}

func nilIfEmptyBytes(value []byte) any {
	if len(value) == 0 {
		return nil
	}
	return value
}
