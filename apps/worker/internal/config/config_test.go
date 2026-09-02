package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadRequiresDedicatedIdentityAndDatabase(t *testing.T) {
	_, err := Load(func(string) string { return "" })
	if err == nil {
		t.Fatal("Load() succeeded without required Worker configuration")
	}
	for _, expected := range []string{"WORKER_ID", "WORKER_DATABASE_URL", "WORKER_ENABLED_PROVIDERS", "INSTANCE_SECRET_KEYS"} {
		if !strings.Contains(err.Error(), expected) {
			t.Fatalf("Load() error %q does not mention %s", err, expected)
		}
	}
}

func TestLoadAppliesPrivateWorkerDefaults(t *testing.T) {
	environment := map[string]string{
		"WORKER_ID":                 "worker-pod-1",
		"WORKER_DATABASE_URL":       "postgresql://worker:secret@postgres.internal/sauryctf",
		"WORKER_ENABLED_PROVIDERS":  "docker",
		"WORKER_DOCKER_PUBLIC_HOST": "instances.example.test",
		"INSTANCE_SECRET_KEYS":      `{"worker-key-v1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"}`,
	}
	config, err := Load(func(key string) string { return environment[key] })
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if config.PlatformID != "sauryctf" || config.ExpectedDatabaseRole != "sauryctf_worker" || config.HealthAddress != ":8081" {
		t.Fatalf("unexpected defaults: %+v", config)
	}
	if config.DatabaseMaxConnections != 10 || config.DatabaseConnectTimeout != 5*time.Second {
		t.Fatalf("unexpected database defaults: %+v", config)
	}
	if config.ReadinessTimeout != 2*time.Second || config.ShutdownTimeout != 15*time.Second {
		t.Fatalf("unexpected lifecycle defaults: %+v", config)
	}
	if config.ClaimBatchSize != 16 || config.JobConcurrency != 16 || config.LeaseDuration != 30*time.Second || config.LeaseRenewInterval != 10*time.Second || config.PollInterval != time.Second || config.ReconcileInterval != 30*time.Second || config.OperationTimeout != 5*time.Minute || config.RetryInitialDelay != time.Second || config.RetryMaxDelay != time.Minute {
		t.Fatalf("unexpected job defaults: %+v", config)
	}
	if len(config.EnabledProviders) != 1 || config.EnabledProviders[0] != "docker" || config.DockerEndpoint != "unix:///var/run/docker.sock" || config.DockerAPIVersion != "v1.47" || config.DockerPublicHost != "instances.example.test" {
		t.Fatalf("unexpected provider defaults: %+v", config)
	}
}

func TestLoadRejectsUnsafeOrUnboundedValues(t *testing.T) {
	environment := map[string]string{
		"WORKER_ID":                        "worker id with spaces",
		"WORKER_PLATFORM_ID":               "Wrong Platform!",
		"WORKER_DATABASE_URL":              "https://example.test/database",
		"WORKER_DATABASE_EXPECTED_ROLE":    "Admin; DROP ROLE",
		"WORKER_DATABASE_MAX_CONNECTIONS":  "101",
		"WORKER_DATABASE_CONNECT_TIMEOUT":  "31s",
		"WORKER_HEALTH_ADDRESS":            "0.0.0.0:70000",
		"WORKER_READINESS_TIMEOUT":         "50ms",
		"WORKER_SHUTDOWN_TIMEOUT":          "0s",
		"WORKER_CLAIM_BATCH_SIZE":          "0",
		"WORKER_JOB_CONCURRENCY":           "101",
		"WORKER_LEASE_DURATION":            "4s",
		"WORKER_LEASE_RENEW_INTERVAL":      "61s",
		"WORKER_POLL_INTERVAL":             "40ms",
		"WORKER_RECONCILE_INTERVAL":        "500ms",
		"WORKER_OPERATION_TIMEOUT":         "31m",
		"WORKER_RETRY_INITIAL_DELAY":       "50ms",
		"WORKER_RETRY_MAX_DELAY":           "61m",
		"WORKER_ENABLED_PROVIDERS":         "docker,docker",
		"WORKER_DOCKER_PUBLIC_HOST":        "",
		"WORKER_KUBERNETES_TCP_PORT_START": "80",
		"INSTANCE_SECRET_KEYS":             `{"bad":"short"}`,
	}
	_, err := Load(func(key string) string { return environment[key] })
	if err == nil {
		t.Fatal("Load() accepted unsafe values")
	}
	for _, expected := range []string{
		"WORKER_ID",
		"WORKER_PLATFORM_ID",
		"WORKER_DATABASE_URL",
		"WORKER_DATABASE_EXPECTED_ROLE",
		"WORKER_DATABASE_MAX_CONNECTIONS",
		"WORKER_DATABASE_CONNECT_TIMEOUT",
		"WORKER_HEALTH_ADDRESS",
		"WORKER_READINESS_TIMEOUT",
		"WORKER_SHUTDOWN_TIMEOUT",
		"WORKER_CLAIM_BATCH_SIZE",
		"WORKER_JOB_CONCURRENCY",
		"WORKER_LEASE_DURATION",
		"WORKER_LEASE_RENEW_INTERVAL",
		"WORKER_POLL_INTERVAL",
		"WORKER_RECONCILE_INTERVAL",
		"WORKER_OPERATION_TIMEOUT",
		"WORKER_RETRY_INITIAL_DELAY",
		"WORKER_RETRY_MAX_DELAY",
		"WORKER_ENABLED_PROVIDERS",
		"WORKER_KUBERNETES_TCP_PORT_START",
		"INSTANCE_SECRET_KEYS",
	} {
		if !strings.Contains(err.Error(), expected) {
			t.Fatalf("Load() error %q does not mention %s", err, expected)
		}
	}
}

func TestLoadRequiresRetryInitialDelayWithinMaximum(t *testing.T) {
	environment := map[string]string{
		"WORKER_ID":                  "worker-pod-1",
		"WORKER_DATABASE_URL":        "postgresql://worker:secret@postgres.internal/sauryctf",
		"WORKER_ENABLED_PROVIDERS":   "kubernetes",
		"WORKER_RETRY_INITIAL_DELAY": "2m",
		"WORKER_RETRY_MAX_DELAY":     "1m",
		"INSTANCE_SECRET_KEYS":       `{"worker-key-v1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"}`,
	}
	_, err := Load(func(key string) string { return environment[key] })
	if err == nil || !strings.Contains(err.Error(), "WORKER_RETRY_INITIAL_DELAY must not exceed") {
		t.Fatalf("Load() error = %v, want retry delay relationship error", err)
	}
}

func TestLoadRequiresRenewalBeforeLeaseExpiry(t *testing.T) {
	environment := map[string]string{
		"WORKER_ID":                   "worker-pod-1",
		"WORKER_DATABASE_URL":         "postgresql://worker:secret@postgres.internal/sauryctf",
		"WORKER_ENABLED_PROVIDERS":    "kubernetes",
		"WORKER_LEASE_DURATION":       "30s",
		"WORKER_LEASE_RENEW_INTERVAL": "30s",
		"INSTANCE_SECRET_KEYS":        `{"worker-key-v1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"}`,
	}
	_, err := Load(func(key string) string { return environment[key] })
	if err == nil || !strings.Contains(err.Error(), "WORKER_LEASE_RENEW_INTERVAL must be shorter") {
		t.Fatalf("Load() error = %v, want renewal/lease relationship error", err)
	}
}

func TestLoadAcceptsBothConcreteProviders(t *testing.T) {
	environment := map[string]string{
		"WORKER_ID":                             "worker-pod-1",
		"WORKER_DATABASE_URL":                   "postgresql://worker:secret@postgres.internal/sauryctf",
		"WORKER_ENABLED_PROVIDERS":              "docker,kubernetes",
		"WORKER_DOCKER_PUBLIC_HOST":             "instances.example.test",
		"WORKER_KUBERNETES_NAMESPACE":           "contest-instances",
		"WORKER_KUBERNETES_HTTP_DOMAIN":         "challenges.example.test",
		"WORKER_KUBERNETES_INGRESS_CLASS":       "nginx",
		"WORKER_KUBERNETES_TLS_SECRET":          "challenge-tls",
		"WORKER_KUBERNETES_TCP_PORT_START":      "30000",
		"WORKER_KUBERNETES_LOAD_BALANCER_CLASS": "example.test/challenge",
		"INSTANCE_SECRET_KEYS":                  `{"worker-key-v1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"}`,
	}
	config, err := Load(func(key string) string { return environment[key] })
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if len(config.EnabledProviders) != 2 || config.KubernetesNamespace != "contest-instances" || config.KubernetesTCPPortStart != 30000 {
		t.Fatalf("provider config = %+v", config)
	}
}
