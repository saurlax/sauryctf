package main

import (
	"testing"

	"github.com/saurlax/sauryctf/apps/worker/internal/config"
	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/secrets"
)

func TestBuildProviderBackendConstructsDockerRuntime(t *testing.T) {
	backend, err := buildProviderBackend(dockerRuntimeConfig(t, "unix:///var/run/docker.sock"))
	if err != nil {
		t.Fatalf("buildProviderBackend() error = %v", err)
	}
	if backend == nil {
		t.Fatal("buildProviderBackend() returned a nil backend")
	}
}

func TestBuildProviderBackendRejectsUnsafeDockerEndpoint(t *testing.T) {
	_, err := buildProviderBackend(dockerRuntimeConfig(t, "http://user:password@docker.example.test"))
	if err == nil {
		t.Fatal("buildProviderBackend() accepted credentials in the Docker endpoint")
	}
}

func dockerRuntimeConfig(t *testing.T, endpoint string) config.Config {
	t.Helper()
	keyring, err := secrets.NewKeyring(map[string][]byte{"worker-key-v1": []byte("0123456789abcdef0123456789abcdef")})
	if err != nil {
		t.Fatal(err)
	}
	return config.Config{
		PlatformID:            "sauryctf",
		EnabledProviders:      []contracts.InstanceProvider{contracts.ProviderDocker},
		DockerEndpoint:        endpoint,
		DockerAPIVersion:      "v1.47",
		DockerPublicHost:      "instances.example.test",
		InstanceSecretKeyring: keyring,
	}
}
