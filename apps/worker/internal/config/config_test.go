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
	for _, expected := range []string{"WORKER_ID", "WORKER_DATABASE_URL"} {
		if !strings.Contains(err.Error(), expected) {
			t.Fatalf("Load() error %q does not mention %s", err, expected)
		}
	}
}

func TestLoadAppliesPrivateWorkerDefaults(t *testing.T) {
	environment := map[string]string{
		"WORKER_ID":           "worker-pod-1",
		"WORKER_DATABASE_URL": "postgresql://worker:secret@postgres.internal/sauryctf",
	}
	config, err := Load(func(key string) string { return environment[key] })
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if config.ExpectedDatabaseRole != "sauryctf_worker" || config.HealthAddress != ":8081" {
		t.Fatalf("unexpected defaults: %+v", config)
	}
	if config.DatabaseMaxConnections != 10 || config.DatabaseConnectTimeout != 5*time.Second {
		t.Fatalf("unexpected database defaults: %+v", config)
	}
	if config.ReadinessTimeout != 2*time.Second || config.ShutdownTimeout != 15*time.Second {
		t.Fatalf("unexpected lifecycle defaults: %+v", config)
	}
	if config.ClaimBatchSize != 16 || config.JobConcurrency != 16 || config.LeaseDuration != 30*time.Second || config.LeaseRenewInterval != 10*time.Second || config.PollInterval != time.Second {
		t.Fatalf("unexpected job defaults: %+v", config)
	}
}

func TestLoadRejectsUnsafeOrUnboundedValues(t *testing.T) {
	environment := map[string]string{
		"WORKER_ID":                       "worker id with spaces",
		"WORKER_DATABASE_URL":             "https://example.test/database",
		"WORKER_DATABASE_EXPECTED_ROLE":   "Admin; DROP ROLE",
		"WORKER_DATABASE_MAX_CONNECTIONS": "101",
		"WORKER_DATABASE_CONNECT_TIMEOUT": "31s",
		"WORKER_HEALTH_ADDRESS":           "0.0.0.0:70000",
		"WORKER_READINESS_TIMEOUT":        "50ms",
		"WORKER_SHUTDOWN_TIMEOUT":         "0s",
		"WORKER_CLAIM_BATCH_SIZE":         "0",
		"WORKER_JOB_CONCURRENCY":          "101",
		"WORKER_LEASE_DURATION":           "4s",
		"WORKER_LEASE_RENEW_INTERVAL":     "61s",
		"WORKER_POLL_INTERVAL":            "40ms",
	}
	_, err := Load(func(key string) string { return environment[key] })
	if err == nil {
		t.Fatal("Load() accepted unsafe values")
	}
	for _, expected := range []string{
		"WORKER_ID",
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
	} {
		if !strings.Contains(err.Error(), expected) {
			t.Fatalf("Load() error %q does not mention %s", err, expected)
		}
	}
}

func TestLoadRequiresRenewalBeforeLeaseExpiry(t *testing.T) {
	environment := map[string]string{
		"WORKER_ID":                   "worker-pod-1",
		"WORKER_DATABASE_URL":         "postgresql://worker:secret@postgres.internal/sauryctf",
		"WORKER_LEASE_DURATION":       "30s",
		"WORKER_LEASE_RENEW_INTERVAL": "30s",
	}
	_, err := Load(func(key string) string { return environment[key] })
	if err == nil || !strings.Contains(err.Error(), "WORKER_LEASE_RENEW_INTERVAL must be shorter") {
		t.Fatalf("Load() error = %v, want renewal/lease relationship error", err)
	}
}
