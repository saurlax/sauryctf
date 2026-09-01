package jobs

import (
	"strings"
	"testing"
)

func TestObservationValidatesStateSpecificData(t *testing.T) {
	validRunning := Observation{
		State:              ObservedRunning,
		ProviderResourceID: "pod/sauryctf-instance-1",
		Entrypoints: []Entrypoint{{
			Name: "web", Protocol: "http", Host: "challenge.example.test", Port: 443,
			URL: "https://challenge.example.test/instance/1",
		}},
		AccessCiphertext: []byte("sealed-access-data"),
	}
	if err := validRunning.Validate(); err != nil {
		t.Fatalf("running Validate() error = %v", err)
	}
	if err := (Observation{
		State: ObservedFailed, ErrorCode: "provider.image_missing", ErrorSummary: "Configured image does not exist",
	}).Validate(); err != nil {
		t.Fatalf("failed Validate() error = %v", err)
	}

	tests := []struct {
		name        string
		observation Observation
	}{
		{name: "unknown state", observation: Observation{State: "ready"}},
		{name: "running without resource", observation: Observation{State: ObservedRunning, Entrypoints: validRunning.Entrypoints}},
		{name: "starting publishes entrypoint", observation: Observation{State: ObservedStarting, Entrypoints: validRunning.Entrypoints}},
		{name: "stopped retains resource", observation: Observation{State: ObservedStopped, ProviderResourceID: "pod/old"}},
		{name: "failed without safe error", observation: Observation{State: ObservedFailed}},
		{name: "success with error", observation: Observation{State: ObservedStarting, ErrorCode: "provider.error", ErrorSummary: "error"}},
		{name: "duplicate endpoint", observation: Observation{State: ObservedRunning, ProviderResourceID: "pod/one", Entrypoints: []Entrypoint{validRunning.Entrypoints[0], validRunning.Entrypoints[0]}}},
		{name: "oversized ciphertext", observation: Observation{State: ObservedRunning, ProviderResourceID: "pod/one", Entrypoints: validRunning.Entrypoints, AccessCiphertext: []byte(strings.Repeat("x", 64*1024+1))}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := test.observation.Validate(); err == nil {
				t.Fatal("Validate() accepted invalid observation")
			}
		})
	}
}

func TestEntrypointRejectsUnsafeOrMismatchedAddress(t *testing.T) {
	tests := []Entrypoint{
		{Name: "Web", Protocol: "http", Host: "challenge.example.test", Port: 443, URL: "https://challenge.example.test"},
		{Name: "web", Protocol: "udp", Host: "challenge.example.test", Port: 443},
		{Name: "web", Protocol: "http", Host: "challenge.example.test", Port: 0, URL: "https://challenge.example.test"},
		{Name: "web", Protocol: "http", Host: "challenge.example.test", Port: 443, URL: "file:///etc/passwd"},
		{Name: "shell", Protocol: "tcp", Host: "challenge.example.test", Port: 31337, URL: "https://challenge.example.test"},
	}
	for _, entrypoint := range tests {
		if err := entrypoint.Validate(); err == nil {
			t.Fatalf("Validate() accepted %+v", entrypoint)
		}
	}
}
