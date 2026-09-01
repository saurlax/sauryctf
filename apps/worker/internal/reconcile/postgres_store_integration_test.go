package reconcile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
)

func TestPostgresStoreLoadsIntentAndConditionallyRecordsObservations(t *testing.T) {
	pool := openReconcileTestDatabase(t)
	insertDesiredInstance(t, pool, 1)
	store := NewPostgresStore(pool)

	instances, err := store.ListDesiredInstances(context.Background())
	if err != nil {
		t.Fatalf("ListDesiredInstances() error = %v", err)
	}
	if len(instances) != 1 {
		t.Fatalf("ListDesiredInstances() count = %d, want 1", len(instances))
	}
	instance := instances[0]
	if instance.ID != uuid(1) || instance.TeamID != uuid(102) || instance.DesiredGeneration != 7 || instance.ObservedGeneration != 0 {
		t.Fatalf("desired instance = %+v", instance)
	}

	observation := jobs.Observation{State: jobs.ObservedStarting, ProviderResourceID: "container/current"}
	if err := store.RecordObservation(context.Background(), instance, "container/current", observation); err != nil {
		t.Fatalf("RecordObservation() error = %v", err)
	}
	if err := store.RecordObservation(context.Background(), instance, "", jobs.Observation{State: jobs.ObservedStopped}); !errors.Is(err, ErrObservationConflict) {
		t.Fatalf("stale RecordObservation() error = %v, want ErrObservationConflict", err)
	}

	var state string
	var generation int64
	var resourceID string
	var version int64
	if err := pool.QueryRow(context.Background(), `
		SELECT observed_state::text, observed_generation, provider_resource_id, version
		FROM instances WHERE id = $1`, string(instance.ID)).Scan(&state, &generation, &resourceID, &version); err != nil {
		t.Fatal(err)
	}
	if state != "starting" || generation != 7 || resourceID != "container/current" || version != 2 {
		t.Fatalf("stored observation = %s/%d/%s/%d", state, generation, resourceID, version)
	}
}

func TestPostgresStoreDeduplicatesSafeOrphanReports(t *testing.T) {
	pool := openReconcileTestDatabase(t)
	store := NewPostgresStore(pool)
	report := OrphanReport{
		Resource:  Resource{Provider: contracts.ProviderDocker, ResourceID: "container/orphan"},
		Ownership: testOwnership("sauryctf", uuid(99), 3),
		Reason:    OrphanUnknownInstance,
	}
	if err := store.ReportOrphan(context.Background(), report); err != nil {
		t.Fatalf("first ReportOrphan() error = %v", err)
	}
	if err := store.ReportOrphan(context.Background(), report); err != nil {
		t.Fatalf("second ReportOrphan() error = %v", err)
	}

	var occurrences int
	var reason string
	var labels map[string]string
	var resolvedAt *time.Time
	if err := pool.QueryRow(context.Background(), `
		SELECT occurrences, reason, ownership_labels, resolved_at
		FROM instance_orphan_reports
		WHERE provider = 'docker' AND provider_resource_id = 'container/orphan'`).Scan(
		&occurrences, &reason, &labels, &resolvedAt,
	); err != nil {
		t.Fatal(err)
	}
	if occurrences != 2 || reason != string(OrphanUnknownInstance) || resolvedAt != nil {
		t.Fatalf("orphan report = %d/%s/%v", occurrences, reason, resolvedAt)
	}
	if len(labels) != 6 || labels[LabelInstance] != string(uuid(99)) {
		t.Fatalf("persisted ownership labels = %#v", labels)
	}
}

func insertDesiredInstance(t *testing.T, pool *pgxpool.Pool, index int) {
	t.Helper()
	payload := map[string]any{
		"target": map[string]string{
			"contest_id": string(uuid(100)), "contest_challenge_id": string(uuid(101)),
			"participation_id": string(uuid(103)), "team_id": string(uuid(102)),
		},
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO instances (
		  id, contest_id, contest_challenge_id, provider, desired_state,
		  desired_generation, observed_state, observed_generation
		) VALUES ($1, $2, $3, 'docker', 'running', 7, 'pending', 0)`,
		string(uuid(index)), string(uuid(100)), string(uuid(101)),
	); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO instance_jobs (
		  id, instance_id, operation, payload, desired_generation, created_at
		) VALUES ($1, $2, 'ensure', $3, 7, now())`,
		string(uuid(index+50)), string(uuid(index)), encoded,
	); err != nil {
		t.Fatal(err)
	}
}

func openReconcileTestDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	adminURL := os.Getenv("TEST_DATABASE_ADMIN_URL")
	if adminURL == "" {
		t.Skip("TEST_DATABASE_ADMIN_URL is required for PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	adminConfig, err := pgxpool.ParseConfig(adminURL)
	if err != nil {
		t.Fatal(err)
	}
	adminPool, err := pgxpool.NewWithConfig(ctx, adminConfig)
	if err != nil {
		t.Fatal(err)
	}
	databaseName := fmt.Sprintf("sauryctf_worker_reconcile_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{databaseName}.Sanitize()
	if _, err := adminPool.Exec(ctx, "CREATE DATABASE "+identifier); err != nil {
		adminPool.Close()
		t.Fatal(err)
	}
	testConfig, err := pgxpool.ParseConfig(adminURL)
	if err != nil {
		t.Fatal(err)
	}
	testConfig.ConnConfig.Database = databaseName
	pool, err := pgxpool.NewWithConfig(ctx, testConfig)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, reconcileTestSchema); err != nil {
		pool.Close()
		adminPool.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = adminPool.Exec(cleanupContext, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, databaseName)
		_, _ = adminPool.Exec(cleanupContext, "DROP DATABASE IF EXISTS "+identifier)
		adminPool.Close()
	})
	return pool
}

const reconcileTestSchema = `
CREATE TYPE instance_provider AS ENUM ('docker', 'kubernetes');
CREATE TYPE instance_desired_state AS ENUM ('running', 'stopped');
CREATE TYPE instance_observed_state AS ENUM ('pending', 'starting', 'running', 'stopping', 'stopped', 'failed', 'unknown');
CREATE TABLE instances (
  id uuid PRIMARY KEY,
  contest_id uuid NOT NULL,
  contest_challenge_id uuid NOT NULL,
  provider instance_provider NOT NULL,
  desired_state instance_desired_state NOT NULL,
  desired_generation bigint NOT NULL,
  observed_state instance_observed_state NOT NULL,
  observed_generation bigint NOT NULL,
  expires_at timestamptz,
  provider_resource_id varchar(255),
  entrypoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  access_ciphertext bytea,
  last_observed_at timestamptz,
  last_error_code varchar(128),
  last_error_summary text,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE instance_jobs (
  id uuid PRIMARY KEY,
  instance_id uuid NOT NULL REFERENCES instances(id),
  operation text NOT NULL,
  payload jsonb NOT NULL,
  desired_generation bigint NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE instance_orphan_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider instance_provider NOT NULL,
  provider_resource_id varchar(255) NOT NULL,
  claimed_instance_id uuid,
  claimed_generation bigint,
  reason varchar(64) NOT NULL,
  ownership_labels jsonb NOT NULL,
  occurrences integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (provider, provider_resource_id)
);`
