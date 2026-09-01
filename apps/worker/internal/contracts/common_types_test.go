package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
	"time"
)

type commonTypesFixture struct {
	ID         UUID            `json:"id"`
	OccurredAt UTCTimestamp    `json:"occurred_at"`
	Score      Score           `json:"score"`
	Version    ResourceVersion `json:"version"`
}

func fixturePath(t *testing.T) string {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve test source path")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(filename), "../../../../contracts/fixtures/common-types.json"))
}

func TestCommonTypesFixtureRoundTripsWithoutLoss(t *testing.T) {
	source, err := os.ReadFile(fixturePath(t))
	if err != nil {
		t.Fatal(err)
	}

	var first commonTypesFixture
	if err := json.Unmarshal(source, &first); err != nil {
		t.Fatal(err)
	}
	roundTrip, err := json.Marshal(first)
	if err != nil {
		t.Fatal(err)
	}
	var second commonTypesFixture
	if err := json.Unmarshal(roundTrip, &second); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("round trip changed fixture: first=%+v second=%+v", first, second)
	}
	if first.Score != Score(-MaxSafeContractInteger) || first.Version != ResourceVersion(MaxSafeContractInteger) {
		t.Fatalf("fixture did not preserve integer boundaries: %+v", first)
	}
}

func TestCommonTypesRejectNonCanonicalValues(t *testing.T) {
	tests := []string{
		`{"id":"018F47A2-4EF8-7E2C-9C24-6D68B7451F2C","occurred_at":"2026-09-01T07:08:09.123Z","score":1,"version":1}`,
		`{"id":"018f47a2-4ef8-7e2c-9c24-6d68b7451f2c","occurred_at":"2026-09-01T15:08:09.123+08:00","score":1,"version":1}`,
		`{"id":"018f47a2-4ef8-7e2c-9c24-6d68b7451f2c","occurred_at":"2026-09-01T07:08:09.123Z","score":1.5,"version":1}`,
		`{"id":"018f47a2-4ef8-7e2c-9c24-6d68b7451f2c","occurred_at":"2026-09-01T07:08:09.123Z","score":1,"version":0}`,
		`{"id":"018f47a2-4ef8-7e2c-9c24-6d68b7451f2c","occurred_at":"2026-09-01T07:08:09.123Z","score":9007199254740992,"version":1}`,
	}

	for _, source := range tests {
		var value commonTypesFixture
		if err := json.Unmarshal([]byte(source), &value); err == nil {
			t.Fatalf("expected rejection for %s", source)
		}
	}
}

func TestUTCTimestampUsesSameMillisecondRepresentationAsTypeScript(t *testing.T) {
	value := time.Date(2026, time.September, 1, 15, 8, 9, 123999999, time.FixedZone("UTC+8", 8*60*60))
	timestamp := NewUTCTimestamp(value)
	if timestamp != "2026-09-01T07:08:09.123Z" {
		t.Fatalf("unexpected timestamp %q", timestamp)
	}
	parsed, err := timestamp.Time()
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Location() != time.UTC {
		t.Fatalf("timestamp did not parse as UTC: %v", parsed.Location())
	}
}
