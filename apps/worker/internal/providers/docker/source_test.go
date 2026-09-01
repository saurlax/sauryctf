package docker

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProviderProductionCodeDoesNotInvokeDockerCLI(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		source, err := os.ReadFile(filepath.Clean(entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		for _, forbidden := range [][]byte{[]byte("os/exec"), []byte("exec.Command"), []byte("docker run"), []byte("docker rm")} {
			if bytes.Contains(source, forbidden) {
				t.Fatalf("%s contains forbidden Docker CLI invocation %q", entry.Name(), forbidden)
			}
		}
	}
}
