package reconcile

import (
	"errors"
	"testing"
)

func TestParseOwnershipRequiresEveryPlatformIdentityLabel(t *testing.T) {
	labels := testOwnership("sauryctf", uuid(1), 7).Labels()
	parsed, err := ParseOwnership(labels, "sauryctf")
	if err != nil {
		t.Fatalf("ParseOwnership() error = %v", err)
	}
	if parsed.Generation != 7 || parsed.Instance != uuid(1) {
		t.Fatalf("ParseOwnership() = %+v", parsed)
	}

	delete(labels, LabelTeam)
	if _, err := ParseOwnership(labels, "sauryctf"); !errors.Is(err, ErrIncompleteLabels) {
		t.Fatalf("incomplete ParseOwnership() error = %v, want ErrIncompleteLabels", err)
	}
}

func TestParseOwnershipRejectsForeignPlatformBeforeConsideringOtherLabels(t *testing.T) {
	labels := map[string]string{LabelPlatform: "another-platform"}
	if _, err := ParseOwnership(labels, "sauryctf"); !errors.Is(err, ErrUnmanagedResource) {
		t.Fatalf("ParseOwnership() error = %v, want ErrUnmanagedResource", err)
	}
}
