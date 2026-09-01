package providers

import (
	"context"
	"errors"
	"fmt"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
)

// SecretDecryptor unwraps one task envelope for the exact instance identity.
// Implementations must authenticate the identity as associated data.
type SecretDecryptor interface {
	Decrypt(contracts.InstanceSecretEnvelope, InstanceKey) ([]SensitiveEnvironmentVariable, error)
}

// SensitiveBackend keeps encrypted task payloads outside runtime providers.
// Decrypted values exist only for the duration of Ensure and are overwritten
// immediately after the provider returns.
type SensitiveBackend struct {
	next      Backend
	decryptor SecretDecryptor
}

func NewSensitiveBackend(next Backend, decryptor SecretDecryptor) (*SensitiveBackend, error) {
	if next == nil || decryptor == nil {
		return nil, errors.New("sensitive backend requires a provider backend and decryptor")
	}
	return &SensitiveBackend{next: next, decryptor: decryptor}, nil
}

func (backend *SensitiveBackend) Ensure(ctx context.Context, spec InstanceSpec) (jobs.Observation, error) {
	if err := spec.Validate(); err != nil {
		return jobs.Observation{}, fmt.Errorf("validate encrypted instance spec: %w", err)
	}
	if spec.Runtime.SecretEnvelope == nil {
		return backend.next.Ensure(ctx, spec)
	}

	decrypted, err := backend.decryptor.Decrypt(*spec.Runtime.SecretEnvelope, spec.Key)
	if err != nil {
		return jobs.Observation{}, jobs.PermanentError(
			"provider.secret_decryption_failed",
			"Instance sensitive payload could not be authenticated",
			err,
		)
	}
	defer clearSensitiveEnvironment(decrypted)
	spec.Runtime.SecretEnvelope = nil
	spec.SensitiveEnvironment = decrypted
	if err := spec.Validate(); err != nil {
		return jobs.Observation{}, jobs.PermanentError(
			"provider.invalid_secret_plaintext",
			"Instance sensitive payload contains an unsupported runtime value",
			err,
		)
	}
	return backend.next.Ensure(ctx, spec)
}

func (backend *SensitiveBackend) Inspect(ctx context.Context, key InstanceKey) (jobs.Observation, error) {
	return backend.next.Inspect(ctx, key)
}

func (backend *SensitiveBackend) Destroy(ctx context.Context, key InstanceKey) (jobs.Observation, error) {
	return backend.next.Destroy(ctx, key)
}

func (backend *SensitiveBackend) ListResources(ctx context.Context) ([]Resource, error) {
	return backend.next.ListResources(ctx)
}

func clearSensitiveEnvironment(environment []SensitiveEnvironmentVariable) {
	for index := range environment {
		for byteIndex := range environment[index].Value {
			environment[index].Value[byteIndex] = 0
		}
		environment[index].Value = nil
	}
}
