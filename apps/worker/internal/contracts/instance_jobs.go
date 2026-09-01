package contracts

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
)

const (
	InstanceJobPayloadVersion uint32 = 1
	InstanceJobSchemaName            = "instance-job.v1"
)

type InstanceJobOperation string

const (
	OperationEnsure    InstanceJobOperation = "ensure"
	OperationInspect   InstanceJobOperation = "inspect"
	OperationDestroy   InstanceJobOperation = "destroy"
	OperationReconcile InstanceJobOperation = "reconcile"
)

func (operation InstanceJobOperation) Validate() error {
	switch operation {
	case OperationEnsure, OperationInspect, OperationDestroy, OperationReconcile:
		return nil
	default:
		return fmt.Errorf("unknown instance job operation %q", operation)
	}
}

type InstanceProvider string

const (
	ProviderDocker     InstanceProvider = "docker"
	ProviderKubernetes InstanceProvider = "kubernetes"
)

func (provider InstanceProvider) Validate() error {
	switch provider {
	case ProviderDocker, ProviderKubernetes:
		return nil
	default:
		return fmt.Errorf("unknown instance provider %q", provider)
	}
}

type InstanceJob struct {
	JobID             UUID                 `json:"job_id"`
	InstanceID        UUID                 `json:"instance_id"`
	Operation         InstanceJobOperation `json:"operation"`
	PayloadVersion    uint32               `json:"payload_version"`
	DesiredGeneration ResourceVersion      `json:"desired_generation"`
	IdempotencyKey    string               `json:"idempotency_key"`
	Payload           InstanceJobPayload   `json:"payload"`
}

type instanceJobWire struct {
	JobID             UUID                 `json:"job_id"`
	InstanceID        UUID                 `json:"instance_id"`
	Operation         InstanceJobOperation `json:"operation"`
	PayloadVersion    uint32               `json:"payload_version"`
	DesiredGeneration ResourceVersion      `json:"desired_generation"`
	IdempotencyKey    string               `json:"idempotency_key"`
	Payload           json.RawMessage      `json:"payload"`
}

type instanceJobMarshalWire struct {
	JobID             UUID                 `json:"job_id"`
	InstanceID        UUID                 `json:"instance_id"`
	Operation         InstanceJobOperation `json:"operation"`
	PayloadVersion    uint32               `json:"payload_version"`
	DesiredGeneration ResourceVersion      `json:"desired_generation"`
	IdempotencyKey    string               `json:"idempotency_key"`
	Payload           InstanceJobPayload   `json:"payload"`
}

var idempotencyKeyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$`)

func DecodeInstanceJob(data []byte) (InstanceJob, error) {
	var wire instanceJobWire
	if err := strictJSONDecode(data, &wire); err != nil {
		return InstanceJob{}, fmt.Errorf("decode instance job envelope: %w", err)
	}

	job := InstanceJob{
		JobID:             wire.JobID,
		InstanceID:        wire.InstanceID,
		Operation:         wire.Operation,
		PayloadVersion:    wire.PayloadVersion,
		DesiredGeneration: wire.DesiredGeneration,
		IdempotencyKey:    wire.IdempotencyKey,
	}
	if err := job.validateEnvelope(); err != nil {
		return InstanceJob{}, err
	}

	var payload InstanceJobPayload
	switch wire.Operation {
	case OperationEnsure:
		payload = &EnsureInstanceJobPayload{}
	case OperationInspect:
		payload = &InspectInstanceJobPayload{}
	case OperationDestroy:
		payload = &DestroyInstanceJobPayload{}
	case OperationReconcile:
		payload = &ReconcileInstanceJobPayload{}
	default:
		return InstanceJob{}, fmt.Errorf("unknown instance job operation %q", wire.Operation)
	}
	if err := strictJSONDecode(wire.Payload, payload); err != nil {
		return InstanceJob{}, fmt.Errorf("decode %s payload: %w", wire.Operation, err)
	}
	if err := validatePayload(wire.Operation, payload); err != nil {
		return InstanceJob{}, err
	}
	job.Payload = payload
	return job, nil
}

func (job *InstanceJob) UnmarshalJSON(data []byte) error {
	decoded, err := DecodeInstanceJob(data)
	if err != nil {
		return err
	}
	*job = decoded
	return nil
}

func (job InstanceJob) MarshalJSON() ([]byte, error) {
	if err := job.validateEnvelope(); err != nil {
		return nil, err
	}
	if err := validatePayload(job.Operation, job.Payload); err != nil {
		return nil, err
	}
	return json.Marshal(instanceJobMarshalWire{
		JobID:             job.JobID,
		InstanceID:        job.InstanceID,
		Operation:         job.Operation,
		PayloadVersion:    job.PayloadVersion,
		DesiredGeneration: job.DesiredGeneration,
		IdempotencyKey:    job.IdempotencyKey,
		Payload:           job.Payload,
	})
}

func (job InstanceJob) validateEnvelope() error {
	if err := job.JobID.Validate(); err != nil {
		return fmt.Errorf("job_id: %w", err)
	}
	if err := job.InstanceID.Validate(); err != nil {
		return fmt.Errorf("instance_id: %w", err)
	}
	if err := job.Operation.Validate(); err != nil {
		return err
	}
	if job.PayloadVersion != InstanceJobPayloadVersion {
		return fmt.Errorf("unsupported instance job payload version %d", job.PayloadVersion)
	}
	if err := job.DesiredGeneration.Validate(); err != nil {
		return fmt.Errorf("desired_generation: %w", err)
	}
	if !idempotencyKeyPattern.MatchString(job.IdempotencyKey) {
		return errors.New("idempotency_key must contain 1-200 safe identifier characters")
	}
	return nil
}

type InstanceJobTarget struct {
	ContestID          UUID `json:"contest_id"`
	ContestChallengeID UUID `json:"contest_challenge_id"`
	ParticipationID    UUID `json:"participation_id"`
	TeamID             UUID `json:"team_id"`
}

func (target InstanceJobTarget) Validate() error {
	fields := []struct {
		name  string
		value UUID
	}{
		{name: "contest_id", value: target.ContestID},
		{name: "contest_challenge_id", value: target.ContestChallengeID},
		{name: "participation_id", value: target.ParticipationID},
		{name: "team_id", value: target.TeamID},
	}
	for _, field := range fields {
		if err := field.value.Validate(); err != nil {
			return fmt.Errorf("%s: %w", field.name, err)
		}
	}
	return nil
}

type InstanceJobPayloadBase struct {
	Schema    string            `json:"schema"`
	Provider  InstanceProvider  `json:"provider"`
	Target    InstanceJobTarget `json:"target"`
	ExpiresAt *UTCTimestamp     `json:"expires_at"`
}

func (payload InstanceJobPayloadBase) Validate() error {
	if payload.Schema != InstanceJobSchemaName {
		return fmt.Errorf("unsupported instance job schema %q", payload.Schema)
	}
	if err := payload.Provider.Validate(); err != nil {
		return err
	}
	if err := payload.Target.Validate(); err != nil {
		return fmt.Errorf("target: %w", err)
	}
	if payload.ExpiresAt != nil {
		if err := payload.ExpiresAt.Validate(); err != nil {
			return fmt.Errorf("expires_at: %w", err)
		}
	}
	return nil
}

type EnsureInstanceJobPayload struct {
	InstanceJobPayloadBase
	Spec InstanceRuntimeSpec `json:"spec"`
}

func (EnsureInstanceJobPayload) instanceJobOperation() InstanceJobOperation {
	return OperationEnsure
}

func (payload EnsureInstanceJobPayload) Validate() error {
	if err := payload.InstanceJobPayloadBase.Validate(); err != nil {
		return err
	}
	return payload.Spec.Validate()
}

type InspectInstanceJobPayload struct {
	InstanceJobPayloadBase
}

func (InspectInstanceJobPayload) instanceJobOperation() InstanceJobOperation {
	return OperationInspect
}

func (payload InspectInstanceJobPayload) Validate() error {
	return payload.InstanceJobPayloadBase.Validate()
}

type DestroyInstanceJobPayload struct {
	InstanceJobPayloadBase
}

func (DestroyInstanceJobPayload) instanceJobOperation() InstanceJobOperation {
	return OperationDestroy
}

func (payload DestroyInstanceJobPayload) Validate() error {
	return payload.InstanceJobPayloadBase.Validate()
}

type InstanceDesiredState string

const (
	DesiredStateRunning InstanceDesiredState = "running"
	DesiredStateStopped InstanceDesiredState = "stopped"
)

type ReconcileInstanceJobPayload struct {
	InstanceJobPayloadBase
	DesiredState InstanceDesiredState `json:"desired_state"`
	Spec         *InstanceRuntimeSpec `json:"spec"`
}

func (ReconcileInstanceJobPayload) instanceJobOperation() InstanceJobOperation {
	return OperationReconcile
}

func (payload ReconcileInstanceJobPayload) Validate() error {
	if err := payload.InstanceJobPayloadBase.Validate(); err != nil {
		return err
	}
	switch payload.DesiredState {
	case DesiredStateRunning:
		if payload.Spec == nil {
			return errors.New("running reconcile payload requires spec")
		}
		return payload.Spec.Validate()
	case DesiredStateStopped:
		if payload.Spec != nil {
			return errors.New("stopped reconcile payload must not include spec")
		}
		return nil
	default:
		return fmt.Errorf("unknown desired state %q", payload.DesiredState)
	}
}

type InstanceRuntimeSpec struct {
	Image          string                        `json:"image"`
	Entrypoints    []InstanceEntrypointSpec      `json:"entrypoints"`
	Environment    []InstanceEnvironmentVariable `json:"environment"`
	Resources      InstanceResourceLimits        `json:"resources"`
	Network        InstanceNetworkPolicy         `json:"network"`
	SecretEnvelope *InstanceSecretEnvelope       `json:"secret_envelope"`
}

var imageReferencePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/:@+-]{0,511}$`)

func (spec InstanceRuntimeSpec) Validate() error {
	if !imageReferencePattern.MatchString(spec.Image) {
		return errors.New("image must be a normalized reference of at most 512 characters")
	}
	if len(spec.Entrypoints) < 1 || len(spec.Entrypoints) > 16 {
		return errors.New("entrypoints must contain 1-16 items")
	}
	entrypointNames := make(map[string]struct{}, len(spec.Entrypoints))
	entrypointSockets := make(map[string]struct{}, len(spec.Entrypoints))
	for index, entrypoint := range spec.Entrypoints {
		if err := entrypoint.Validate(); err != nil {
			return fmt.Errorf("entrypoints[%d]: %w", index, err)
		}
		if _, exists := entrypointNames[entrypoint.Name]; exists {
			return fmt.Errorf("entrypoints[%d]: duplicate name %q", index, entrypoint.Name)
		}
		socket := fmt.Sprintf("%s:%d", entrypoint.Protocol, entrypoint.ContainerPort)
		if _, exists := entrypointSockets[socket]; exists {
			return fmt.Errorf("entrypoints[%d]: duplicate socket %q", index, socket)
		}
		entrypointNames[entrypoint.Name] = struct{}{}
		entrypointSockets[socket] = struct{}{}
	}
	if len(spec.Environment) > 100 {
		return errors.New("environment must contain at most 100 items")
	}
	environmentNames := make(map[string]struct{}, len(spec.Environment))
	for index, variable := range spec.Environment {
		if err := variable.Validate(); err != nil {
			return fmt.Errorf("environment[%d]: %w", index, err)
		}
		if _, exists := environmentNames[variable.Name]; exists {
			return fmt.Errorf("environment[%d]: duplicate name %q", index, variable.Name)
		}
		environmentNames[variable.Name] = struct{}{}
	}
	if err := spec.Resources.Validate(); err != nil {
		return fmt.Errorf("resources: %w", err)
	}
	if err := spec.Network.Validate(); err != nil {
		return fmt.Errorf("network: %w", err)
	}
	if spec.SecretEnvelope != nil {
		if err := spec.SecretEnvelope.Validate(); err != nil {
			return fmt.Errorf("secret_envelope: %w", err)
		}
	}
	return nil
}

type InstanceEntrypointSpec struct {
	Name          string `json:"name"`
	Protocol      string `json:"protocol"`
	ContainerPort int    `json:"container_port"`
}

var entrypointNamePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)

func (entrypoint InstanceEntrypointSpec) Validate() error {
	if !entrypointNamePattern.MatchString(entrypoint.Name) {
		return errors.New("name must be a lower-case identifier of at most 32 characters")
	}
	if entrypoint.Protocol != "http" && entrypoint.Protocol != "tcp" {
		return fmt.Errorf("unknown protocol %q", entrypoint.Protocol)
	}
	if entrypoint.ContainerPort < 1 || entrypoint.ContainerPort > 65535 {
		return errors.New("container_port must be between 1 and 65535")
	}
	return nil
}

type InstanceEnvironmentVariable struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

var environmentNamePattern = regexp.MustCompile(`^[A-Z_][A-Z0-9_]{0,127}$`)

func (variable InstanceEnvironmentVariable) Validate() error {
	if !environmentNamePattern.MatchString(variable.Name) {
		return errors.New("name must be an upper-case environment identifier of at most 128 characters")
	}
	if strings.HasPrefix(variable.Name, "SAURYCTF_") {
		return errors.New("name uses the platform-reserved SAURYCTF_ prefix")
	}
	if len(variable.Value) > 8192 {
		return errors.New("value exceeds 8192 UTF-8 bytes")
	}
	return nil
}

type InstanceResourceLimits struct {
	CPUMillicores         int64 `json:"cpu_millicores"`
	MemoryBytes           int64 `json:"memory_bytes"`
	EphemeralStorageBytes int64 `json:"ephemeral_storage_bytes"`
}

func (limits InstanceResourceLimits) Validate() error {
	if limits.CPUMillicores < 10 || limits.CPUMillicores > 64000 {
		return errors.New("cpu_millicores must be between 10 and 64000")
	}
	if limits.MemoryBytes < 16*1024*1024 || limits.MemoryBytes > 512*1024*1024*1024 {
		return errors.New("memory_bytes is outside the supported range")
	}
	if limits.EphemeralStorageBytes < 16*1024*1024 || limits.EphemeralStorageBytes > 1024*1024*1024*1024 {
		return errors.New("ephemeral_storage_bytes is outside the supported range")
	}
	return nil
}

type InstanceNetworkPolicy struct {
	Egress string `json:"egress"`
}

func (policy InstanceNetworkPolicy) Validate() error {
	if policy.Egress != "deny" && policy.Egress != "internet" {
		return fmt.Errorf("unknown egress policy %q", policy.Egress)
	}
	return nil
}

type InstanceSecretEnvelope struct {
	Schema           string `json:"schema"`
	KeyID            string `json:"key_id"`
	CiphertextBase64 string `json:"ciphertext_base64"`
}

var secretKeyIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)

func (envelope InstanceSecretEnvelope) Validate() error {
	if envelope.Schema != "instance-secrets.v1" {
		return fmt.Errorf("unsupported secret envelope schema %q", envelope.Schema)
	}
	if !secretKeyIDPattern.MatchString(envelope.KeyID) {
		return errors.New("key_id must contain 1-128 safe identifier characters")
	}
	if len(envelope.CiphertextBase64) < 4 || len(envelope.CiphertextBase64) > 65536 {
		return errors.New("ciphertext_base64 length is outside the supported range")
	}
	if _, err := base64.StdEncoding.Strict().DecodeString(envelope.CiphertextBase64); err != nil {
		return errors.New("ciphertext_base64 must use canonical base64")
	}
	return nil
}

type InstanceJobPayload interface {
	Validate() error
	instanceJobOperation() InstanceJobOperation
}

func validatePayload(operation InstanceJobOperation, payload InstanceJobPayload) error {
	if payload == nil || nilInstanceJobPayload(payload) {
		return fmt.Errorf("payload does not match %s operation", operation)
	}
	if payload.instanceJobOperation() != operation {
		return fmt.Errorf("payload does not match %s operation", operation)
	}
	if err := payload.Validate(); err != nil {
		return fmt.Errorf("invalid %s payload: %w", operation, err)
	}
	return nil
}

func nilInstanceJobPayload(payload InstanceJobPayload) bool {
	switch typed := payload.(type) {
	case *EnsureInstanceJobPayload:
		return typed == nil
	case *InspectInstanceJobPayload:
		return typed == nil
	case *DestroyInstanceJobPayload:
		return typed == nil
	case *ReconcileInstanceJobPayload:
		return typed == nil
	default:
		return false
	}
}

func strictJSONDecode(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values are not allowed")
		}
		return err
	}
	return nil
}
