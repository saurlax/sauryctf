package providers_test

import (
	"context"
	"errors"
	"testing"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
)

func TestSensitiveBackendDecryptsForEnsureAndClearsPlaintext(t *testing.T) {
	plaintext := []byte("flag{memory-must-be-cleared}")
	decryptor := &capturingDecryptor{plaintext: plaintext}
	next := &capturingBackend{}
	backend, err := providers.NewSensitiveBackend(next, decryptor)
	if err != nil {
		t.Fatal(err)
	}
	spec := sensitiveTestSpec()
	if _, err := backend.Ensure(context.Background(), spec); err != nil {
		t.Fatalf("Ensure() error = %v", err)
	}
	if decryptor.key != spec.Key {
		t.Fatalf("decrypt key = %+v, want %+v", decryptor.key, spec.Key)
	}
	if next.spec.Runtime.SecretEnvelope != nil {
		t.Fatal("provider received the encrypted task envelope")
	}
	if next.receivedValue != "flag{memory-must-be-cleared}" {
		t.Fatalf("provider plaintext = %q", next.receivedValue)
	}
	for index, value := range plaintext {
		if value != 0 {
			t.Fatalf("plaintext byte %d was not cleared", index)
		}
	}
}

func TestSensitiveBackendReturnsSafePermanentFailure(t *testing.T) {
	backend, err := providers.NewSensitiveBackend(&capturingBackend{}, failingDecryptor{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = backend.Ensure(context.Background(), sensitiveTestSpec())
	failure := jobs.ClassifyFailure(err)
	if failure.Kind != jobs.FailurePermanent || failure.Code != "provider.secret_decryption_failed" {
		t.Fatalf("failure = %+v / %v", failure, err)
	}
	if failure.Summary == "flag{must-not-leak}" {
		t.Fatal("failure summary exposed plaintext")
	}
	if err.Error() == "flag{must-not-leak}" {
		t.Fatal("logged error text would expose plaintext")
	}
}

type capturingDecryptor struct {
	plaintext []byte
	key       providers.InstanceKey
}

func (decryptor *capturingDecryptor) Decrypt(_ contracts.InstanceSecretEnvelope, key providers.InstanceKey) ([]providers.SensitiveEnvironmentVariable, error) {
	decryptor.key = key
	return []providers.SensitiveEnvironmentVariable{{Name: "SAURYCTF_FLAG", Value: decryptor.plaintext}}, nil
}

type failingDecryptor struct{}

func (failingDecryptor) Decrypt(contracts.InstanceSecretEnvelope, providers.InstanceKey) ([]providers.SensitiveEnvironmentVariable, error) {
	return nil, errors.New("flag{must-not-leak}")
}

type capturingBackend struct {
	spec          providers.InstanceSpec
	receivedValue string
}

func (backend *capturingBackend) Ensure(_ context.Context, spec providers.InstanceSpec) (jobs.Observation, error) {
	backend.spec = spec
	backend.receivedValue = string(spec.SensitiveEnvironment[0].Value)
	return jobs.Observation{State: jobs.ObservedStarting, ProviderResourceID: "runtime/instance"}, nil
}

func (*capturingBackend) Inspect(context.Context, providers.InstanceKey) (jobs.Observation, error) {
	return jobs.Observation{State: jobs.ObservedStarting, ProviderResourceID: "runtime/instance"}, nil
}

func (*capturingBackend) Destroy(context.Context, providers.InstanceKey) (jobs.Observation, error) {
	return jobs.Observation{State: jobs.ObservedStopped}, nil
}

func (*capturingBackend) ListResources(context.Context) ([]providers.Resource, error) {
	return nil, nil
}

func sensitiveTestSpec() providers.InstanceSpec {
	return providers.InstanceSpec{
		Key: providers.InstanceKey{
			Platform: "sauryctf", Provider: contracts.ProviderDocker,
			Contest: "018f47a2-4ef8-7e2c-9c24-6d68b7451021", Challenge: "018f47a2-4ef8-7e2c-9c24-6d68b7451031",
			Team: "018f47a2-4ef8-7e2c-9c24-6d68b7451051", Instance: "018f47a2-4ef8-7e2c-9c24-6d68b7451001", Generation: 7,
		},
		Runtime: contracts.InstanceRuntimeSpec{
			Image:       "registry.example.test/challenge@sha256:0123456789abcdef",
			Entrypoints: []contracts.InstanceEntrypointSpec{{Name: "web", Protocol: "http", ContainerPort: 8080}},
			Resources:   contracts.InstanceResourceLimits{CPUMillicores: 100, MemoryBytes: 64 * 1024 * 1024, EphemeralStorageBytes: 64 * 1024 * 1024},
			Network:     contracts.InstanceNetworkPolicy{Egress: "deny"},
			SecretEnvelope: &contracts.InstanceSecretEnvelope{
				Schema: "instance-secrets.v1", KeyID: "worker-key-v1", CiphertextBase64: "AAECAwQFBgcICQ==",
			},
		},
	}
}
