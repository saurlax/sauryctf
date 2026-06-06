package games

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/saurlax/sauryctf/internal/models"
)

type fakeDockerCommandRunner struct {
	calls   [][]string
	outputs map[string]fakeDockerCommandResult
}

type fakeDockerCommandResult struct {
	output []byte
	err    error
}

func (f *fakeDockerCommandRunner) Run(ctx context.Context, args ...string) ([]byte, error) {
	_ = ctx
	copied := append([]string(nil), args...)
	f.calls = append(f.calls, copied)

	key := strings.Join(args, "\x00")
	if result, ok := f.outputs[key]; ok {
		return result.output, result.err
	}

	return nil, fmt.Errorf("unexpected docker args: %v", args)
}

func TestDockerCLIProvider_EnsureLeaseCreatesContainerAndInspectsRandomPort(t *testing.T) {
	runner := &fakeDockerCommandRunner{
		outputs: map[string]fakeDockerCommandResult{
			strings.Join([]string{
				"run", "-d",
				"--name", "sauryctf-g12-c34-t56-578dd75cad60",
				"--label", "sauryctf.managed=true",
				"--label", "sauryctf.game_id=12",
				"--label", "sauryctf.challenge_id=34",
				"--label", "sauryctf.team_id=56",
				"-p", "80",
				"-p", "443/tcp",
				"nginx:alpine",
			}, "\x00"): {
				output: []byte("container-id\n"),
			},
			strings.Join([]string{"inspect", "--format", "{{json .NetworkSettings.Ports}}", "sauryctf-g12-c34-t56-578dd75cad60"}, "\x00"): {
				output: []byte(`{"80/tcp":[{"HostIp":"0.0.0.0","HostPort":"49123"}],"443/tcp":[{"HostIp":"0.0.0.0","HostPort":"49124"}]}`),
			},
		},
	}

	provider := newDockerCLIProvider("127.0.0.1", runner).(*dockerCLIProvider)
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)

	state, err := provider.EnsureLease(ChallengeInstanceProviderRequest{
		GameID:            12,
		ChallengeID:       34,
		TeamID:            56,
		UserID:            78,
		Now:               now,
		LeaseDuration:     30 * time.Minute,
		ExtensionDuration: 30 * time.Minute,
		Runtime: ChallengeInstanceRuntimeSpec{
			Provider: "docker",
			Image:    "nginx:alpine",
			Expose:   []string{"80", "443/tcp"},
			Note:     "fixture note",
		},
	})
	require.NoError(t, err)

	require.Len(t, runner.calls, 2)
	assert.Equal(t, []string{
		"run", "-d",
		"--name", "sauryctf-g12-c34-t56-578dd75cad60",
		"--label", "sauryctf.managed=true",
		"--label", "sauryctf.game_id=12",
		"--label", "sauryctf.challenge_id=34",
		"--label", "sauryctf.team_id=56",
		"-p", "80",
		"-p", "443/tcp",
		"nginx:alpine",
	}, runner.calls[0])
	assert.Equal(t, []string{"inspect", "--format", "{{json .NetworkSettings.Ports}}", "sauryctf-g12-c34-t56-578dd75cad60"}, runner.calls[1])

	assert.Equal(t, "docker", state.Provider)
	assert.Equal(t, "nginx:alpine", state.Image)
	assert.Equal(t, "127.0.0.1", state.Host)
	assert.Equal(t, "49123", state.Port)
	assert.Equal(t, "http://127.0.0.1:49123", state.LaunchURL)
	assert.Equal(t, now, state.StartedAt)
	assert.Equal(t, now, state.LastRenewedAt)
	assert.Equal(t, now.Add(30*time.Minute), state.ExpiresAt)
	assert.Contains(t, state.Note, "fixture note")
	assert.Contains(t, state.Note, "docker container: sauryctf-g12-c34-t56-578dd75cad60")
}

func TestDockerCLIProvider_EnsureLeaseReusesExistingContainer(t *testing.T) {
	runner := &fakeDockerCommandRunner{
		outputs: map[string]fakeDockerCommandResult{
			strings.Join([]string{"inspect", "sauryctf-g3-c4-t5-64b47ee0d554"}, "\x00"): {
				output: []byte("{}"),
			},
			strings.Join([]string{"inspect", "--format", "{{json .NetworkSettings.Ports}}", "sauryctf-g3-c4-t5-64b47ee0d554"}, "\x00"): {
				output: []byte(`{"80/tcp":[{"HostIp":"0.0.0.0","HostPort":"38080"}]}`),
			},
		},
	}

	provider := newDockerCLIProvider("127.0.0.1", runner).(*dockerCLIProvider)
	startedAt := time.Date(2026, 6, 5, 10, 0, 0, 0, time.UTC)
	now := startedAt.Add(20 * time.Minute)

	state, err := provider.EnsureLease(ChallengeInstanceProviderRequest{
		GameID:            3,
		ChallengeID:       4,
		TeamID:            5,
		UserID:            6,
		Now:               now,
		LeaseDuration:     30 * time.Minute,
		ExtensionDuration: 15 * time.Minute,
		Runtime: ChallengeInstanceRuntimeSpec{
			Provider: "docker",
			Image:    "nginx:alpine",
			Expose:   []string{"80"},
		},
		Existing: &models.GameInstanceLease{
			Provider:      "docker",
			Image:         "nginx:alpine",
			StartedAt:     startedAt,
			LastRenewedAt: startedAt,
			ExpiresAt:     now.Add(5 * time.Minute),
		},
	})
	require.NoError(t, err)

	require.Len(t, runner.calls, 2)
	assert.Equal(t, []string{"inspect", "sauryctf-g3-c4-t5-64b47ee0d554"}, runner.calls[0])
	assert.Equal(t, []string{"inspect", "--format", "{{json .NetworkSettings.Ports}}", "sauryctf-g3-c4-t5-64b47ee0d554"}, runner.calls[1])
	assert.Equal(t, startedAt, state.StartedAt)
	assert.Equal(t, now.Add(20*time.Minute), state.ExpiresAt)
	assert.Equal(t, "38080", state.Port)
}

func TestDockerCLIProvider_DestroyLeaseRemovesContainer(t *testing.T) {
	runner := &fakeDockerCommandRunner{
		outputs: map[string]fakeDockerCommandResult{
			strings.Join([]string{"rm", "-f", "sauryctf-g7-c8-t9-293f756e2f93"}, "\x00"): {
				output: []byte("sauryctf-g7-c8-t9-293f756e2f93\n"),
			},
		},
	}

	provider := newDockerCLIProvider("127.0.0.1", runner).(*dockerCLIProvider)
	err := provider.DestroyLease(ChallengeInstanceProviderRequest{
		GameID:      7,
		ChallengeID: 8,
		TeamID:      9,
	})
	require.NoError(t, err)
	require.Len(t, runner.calls, 1)
	assert.Equal(t, []string{"rm", "-f", "sauryctf-g7-c8-t9-293f756e2f93"}, runner.calls[0])
}

func TestDockerCLIProvider_DestroyLeaseIgnoresMissingContainer(t *testing.T) {
	runner := &fakeDockerCommandRunner{
		outputs: map[string]fakeDockerCommandResult{
			strings.Join([]string{"rm", "-f", "sauryctf-g7-c8-t9-293f756e2f93"}, "\x00"): {
				output: []byte("Error response from daemon: No such container: sauryctf-g7-c8-t9-293f756e2f93"),
				err:    fmt.Errorf("exit status 1"),
			},
		},
	}

	provider := newDockerCLIProvider("127.0.0.1", runner).(*dockerCLIProvider)
	err := provider.DestroyLease(ChallengeInstanceProviderRequest{
		GameID:      7,
		ChallengeID: 8,
		TeamID:      9,
	})
	require.NoError(t, err)
}

func TestDockerPortKeyUsesContainerSidePortForPublishedMappings(t *testing.T) {
	assert.Equal(t, "80/tcp", dockerPortKey("80"))
	assert.Equal(t, "80/tcp", dockerPortKey("8080:80"))
	assert.Equal(t, "80/tcp", dockerPortKey("127.0.0.1:8080:80"))
	assert.Equal(t, "80/tcp", dockerPortKey("127.0.0.1::80"))
	assert.Equal(t, "53/udp", dockerPortKey("127.0.0.1:5300:53/udp"))
}

func TestDockerCLIProvider_EnsureLeaseMatchesInspectPortsForPublishedMappings(t *testing.T) {
	req := ChallengeInstanceProviderRequest{
		GameID:            21,
		ChallengeID:       22,
		TeamID:            23,
		UserID:            24,
		Now:               time.Date(2026, 6, 7, 8, 0, 0, 0, time.UTC),
		LeaseDuration:     30 * time.Minute,
		ExtensionDuration: 30 * time.Minute,
		Runtime: ChallengeInstanceRuntimeSpec{
			Provider: "docker",
			Image:    "nginx:alpine",
			Expose:   []string{"127.0.0.1:8080:80"},
		},
	}
	containerName := dockerInstanceContainerName(req)

	runner := &fakeDockerCommandRunner{
		outputs: map[string]fakeDockerCommandResult{
			strings.Join([]string{
				"run", "-d",
				"--name", containerName,
				"--label", "sauryctf.managed=true",
				"--label", "sauryctf.game_id=21",
				"--label", "sauryctf.challenge_id=22",
				"--label", "sauryctf.team_id=23",
				"-p", "127.0.0.1:8080:80",
				"nginx:alpine",
			}, "\x00"): {
				output: []byte("container-id\n"),
			},
			strings.Join([]string{"inspect", "--format", "{{json .NetworkSettings.Ports}}", containerName}, "\x00"): {
				output: []byte(`{"80/tcp":[{"HostIp":"127.0.0.1","HostPort":"8080"}]}`),
			},
		},
	}

	provider := newDockerCLIProvider("127.0.0.1", runner).(*dockerCLIProvider)
	state, err := provider.EnsureLease(req)
	require.NoError(t, err)

	require.Len(t, runner.calls, 2)
	assert.Equal(t, "8080", state.Port)
	assert.Equal(t, "http://127.0.0.1:8080", state.LaunchURL)
}
