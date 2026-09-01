package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

var ErrObservationRejected = errors.New("instance observation is stale or no longer authorized")

type ObservedState string

const (
	ObservedPending  ObservedState = "pending"
	ObservedStarting ObservedState = "starting"
	ObservedRunning  ObservedState = "running"
	ObservedStopping ObservedState = "stopping"
	ObservedStopped  ObservedState = "stopped"
	ObservedFailed   ObservedState = "failed"
	ObservedUnknown  ObservedState = "unknown"
)

type Entrypoint struct {
	Name     string `json:"name"`
	Protocol string `json:"protocol"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	URL      string `json:"url,omitempty"`
}

type Observation struct {
	State              ObservedState
	ProviderResourceID string
	Entrypoints        []Entrypoint
	AccessCiphertext   []byte
	ErrorCode          string
	ErrorSummary       string
}

var observedEntrypointNamePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)

func (observation Observation) Validate() error {
	switch observation.State {
	case ObservedPending, ObservedStarting, ObservedRunning, ObservedStopping, ObservedStopped, ObservedFailed, ObservedUnknown:
	default:
		return fmt.Errorf("unknown observed state %q", observation.State)
	}
	if len(observation.ProviderResourceID) > 255 || strings.TrimSpace(observation.ProviderResourceID) != observation.ProviderResourceID {
		return errors.New("provider resource id must contain at most 255 trimmed characters")
	}
	if len(observation.AccessCiphertext) > 64*1024 {
		return errors.New("access ciphertext exceeds 64 KiB")
	}
	if len(observation.Entrypoints) > 16 {
		return errors.New("observation must contain at most 16 entrypoints")
	}
	names := make(map[string]struct{}, len(observation.Entrypoints))
	for index, entrypoint := range observation.Entrypoints {
		if err := entrypoint.Validate(); err != nil {
			return fmt.Errorf("entrypoints[%d]: %w", index, err)
		}
		if _, exists := names[entrypoint.Name]; exists {
			return fmt.Errorf("entrypoints[%d]: duplicate name %q", index, entrypoint.Name)
		}
		names[entrypoint.Name] = struct{}{}
	}
	if observation.State == ObservedRunning {
		if observation.ProviderResourceID == "" || len(observation.Entrypoints) == 0 {
			return errors.New("running observation requires a provider resource and ready entrypoint")
		}
	} else if len(observation.Entrypoints) != 0 || len(observation.AccessCiphertext) != 0 {
		return errors.New("only running observations may publish entrypoints or access ciphertext")
	}
	if observation.State == ObservedStopped && observation.ProviderResourceID != "" {
		return errors.New("stopped observation must clear the provider resource id")
	}
	if observation.State == ObservedFailed || observation.State == ObservedUnknown {
		if !failureCodePattern.MatchString(observation.ErrorCode) || strings.TrimSpace(observation.ErrorSummary) == "" || len(observation.ErrorSummary) > 1024 {
			return errors.New("failed or unknown observation requires safe error metadata")
		}
	} else if observation.ErrorCode != "" || observation.ErrorSummary != "" {
		return errors.New("non-error observation must not include error metadata")
	}
	return nil
}

func (entrypoint Entrypoint) Validate() error {
	if !observedEntrypointNamePattern.MatchString(entrypoint.Name) {
		return errors.New("name must be a lower-case identifier of at most 32 characters")
	}
	if entrypoint.Protocol != "http" && entrypoint.Protocol != "tcp" {
		return fmt.Errorf("unknown protocol %q", entrypoint.Protocol)
	}
	if strings.TrimSpace(entrypoint.Host) == "" || strings.TrimSpace(entrypoint.Host) != entrypoint.Host || len(entrypoint.Host) > 253 {
		return errors.New("host must contain 1-253 trimmed characters")
	}
	if entrypoint.Port < 1 || entrypoint.Port > 65535 {
		return errors.New("port must be between 1 and 65535")
	}
	if entrypoint.Protocol == "http" {
		parsed, err := url.Parse(entrypoint.URL)
		if err != nil || parsed.Scheme != "http" && parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
			return errors.New("http entrypoint requires an absolute http or https URL without userinfo")
		}
	} else if entrypoint.URL != "" {
		return errors.New("tcp entrypoint must not include a URL")
	}
	return nil
}

func (repository *PostgresRepository) RecordObservation(ctx context.Context, lease Lease, observation Observation) error {
	if err := observation.Validate(); err != nil {
		return fmt.Errorf("validate instance observation: %w", err)
	}
	entrypoints, err := json.Marshal(observation.Entrypoints)
	if err != nil {
		return fmt.Errorf("encode instance observation entrypoints: %w", err)
	}
	providerResourceID := any(observation.ProviderResourceID)
	if observation.ProviderResourceID == "" {
		providerResourceID = nil
	}
	accessCiphertext := any(observation.AccessCiphertext)
	if len(observation.AccessCiphertext) == 0 {
		accessCiphertext = nil
	}
	errorCode := any(observation.ErrorCode)
	errorSummary := any(observation.ErrorSummary)
	if observation.ErrorCode == "" {
		errorCode = nil
		errorSummary = nil
	}
	generation := int64(lease.Job.DesiredGeneration)
	result, err := repository.pool.Exec(ctx, `
UPDATE instances AS instance
SET observed_state = $4::public.instance_observed_state,
    observed_generation = $5,
    provider_resource_id = $6,
    entrypoints = $7,
    access_ciphertext = $8,
    last_observed_at = clock_timestamp(),
    last_error_code = $9,
    last_error_summary = $10,
    version = instance.version + 1,
    updated_at = clock_timestamp()
FROM instance_jobs AS job
WHERE job.id = $1 AND instance.id = $2 AND job.instance_id = instance.id
  AND job.status = 'leased' AND job.lease_owner = $3
  AND job.fencing_token = $11 AND job.lease_until > clock_timestamp()
  AND job.desired_generation = $5 AND instance.desired_generation = $5
  AND instance.observed_generation <= $5`,
		string(lease.Job.JobID), string(lease.Job.InstanceID), lease.Owner,
		observation.State, generation, providerResourceID, entrypoints,
		accessCiphertext, errorCode, errorSummary, lease.FencingToken)
	if err != nil {
		return fmt.Errorf("record instance observation: %w", err)
	}
	if result.RowsAffected() != 1 {
		return ErrObservationRejected
	}
	return nil
}
