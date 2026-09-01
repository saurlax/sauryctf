package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func instanceJobFixturePath(t *testing.T, parts ...string) string {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve test source path")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(filename), "../../../../contracts/fixtures/instance-jobs"))
	return filepath.Join(append([]string{root}, parts...)...)
}

func TestInstanceJobV1FixturesRoundTripAcrossGoBoundary(t *testing.T) {
	operations := []InstanceJobOperation{
		OperationEnsure,
		OperationInspect,
		OperationDestroy,
		OperationReconcile,
	}
	for _, operation := range operations {
		t.Run(string(operation), func(t *testing.T) {
			source, err := os.ReadFile(instanceJobFixturePath(t, "v1", string(operation)+".json"))
			if err != nil {
				t.Fatal(err)
			}
			job, err := DecodeInstanceJob(source)
			if err != nil {
				t.Fatalf("DecodeInstanceJob() error = %v", err)
			}
			if job.Operation != operation {
				t.Fatalf("operation = %q, want %q", job.Operation, operation)
			}

			roundTrip, err := json.Marshal(job)
			if err != nil {
				t.Fatalf("Marshal() error = %v", err)
			}
			var decodedAgain InstanceJob
			if err := json.Unmarshal(roundTrip, &decodedAgain); err != nil {
				t.Fatalf("Unmarshal() error = %v", err)
			}
			if !reflect.DeepEqual(job, decodedAgain) {
				t.Fatalf("round trip changed job:\nfirst=%#v\nsecond=%#v", job, decodedAgain)
			}

			var sourceJSON any
			var roundTripJSON any
			if err := json.Unmarshal(source, &sourceJSON); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(roundTrip, &roundTripJSON); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(sourceJSON, roundTripJSON) {
				t.Fatalf("round trip changed shared JSON fixture:\nsource=%s\nround_trip=%s", source, roundTrip)
			}
		})
	}
}

func TestInstanceJobRejectsUnknownOperation(t *testing.T) {
	source, err := os.ReadFile(instanceJobFixturePath(t, "invalid", "unknown-operation.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeInstanceJob(source); err == nil || !strings.Contains(err.Error(), "unknown instance job operation") {
		t.Fatalf("DecodeInstanceJob() error = %v, want unknown operation", err)
	}
}

func TestInstanceJobRejectsMismatchedPayloadAndUnknownFields(t *testing.T) {
	ensureSource, err := os.ReadFile(instanceJobFixturePath(t, "v1", "ensure.json"))
	if err != nil {
		t.Fatal(err)
	}
	var ensure map[string]any
	if err := json.Unmarshal(ensureSource, &ensure); err != nil {
		t.Fatal(err)
	}
	ensure["operation"] = "inspect"
	mismatched, err := json.Marshal(ensure)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeInstanceJob(mismatched); err == nil || !strings.Contains(err.Error(), "unknown field \"spec\"") {
		t.Fatalf("DecodeInstanceJob() error = %v, want strict payload mismatch", err)
	}

	ensure["operation"] = "ensure"
	ensure["unexpected"] = true
	unknownField, err := json.Marshal(ensure)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeInstanceJob(unknownField); err == nil || !strings.Contains(err.Error(), "unknown field \"unexpected\"") {
		t.Fatalf("DecodeInstanceJob() error = %v, want strict envelope rejection", err)
	}
}

func TestInstanceJobRejectsUnknownVersionAndUnsafeRuntimeSpec(t *testing.T) {
	source, err := os.ReadFile(instanceJobFixturePath(t, "v1", "ensure.json"))
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]any
	if err := json.Unmarshal(source, &envelope); err != nil {
		t.Fatal(err)
	}
	envelope["payload_version"] = float64(2)
	unknownVersion, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeInstanceJob(unknownVersion); err == nil || !strings.Contains(err.Error(), "unsupported instance job payload version") {
		t.Fatalf("DecodeInstanceJob() error = %v, want unknown version", err)
	}

	envelope["payload_version"] = float64(1)
	payload := envelope["payload"].(map[string]any)
	spec := payload["spec"].(map[string]any)
	spec["environment"] = []any{map[string]any{"name": "SAURYCTF_FLAG", "value": "plain-text-is-forbidden"}}
	unsafeSpec, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeInstanceJob(unsafeSpec); err == nil || !strings.Contains(err.Error(), "platform-reserved") {
		t.Fatalf("DecodeInstanceJob() error = %v, want reserved environment rejection", err)
	}
}

func TestInstanceJobRejectsInvalidReconcileStateShape(t *testing.T) {
	source, err := os.ReadFile(instanceJobFixturePath(t, "v1", "reconcile.json"))
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]any
	if err := json.Unmarshal(source, &envelope); err != nil {
		t.Fatal(err)
	}
	payload := envelope["payload"].(map[string]any)
	payload["desired_state"] = "running"
	invalid, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeInstanceJob(invalid); err == nil || !strings.Contains(err.Error(), "requires spec") {
		t.Fatalf("DecodeInstanceJob() error = %v, want running reconcile spec requirement", err)
	}
}
