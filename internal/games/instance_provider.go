package games

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os/exec"
	"sort"
	"strings"
	"time"

	"github.com/saurlax/sauryctf/internal/models"
)

type leaseSkeletonProvider struct{}

type dockerCommandRunner interface {
	Run(ctx context.Context, args ...string) ([]byte, error)
}

type execDockerCommandRunner struct {
	binary string
}

func (r *execDockerCommandRunner) Run(ctx context.Context, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, r.binary, args...)
	return cmd.CombinedOutput()
}

type dockerCLIProvider struct {
	host    string
	timeout time.Duration
	runner  dockerCommandRunner
}

type dockerPortBinding struct {
	HostIP   string `json:"HostIp"`
	HostPort string `json:"HostPort"`
}

func NewLeaseSkeletonProvider() ChallengeInstanceProvider {
	return &leaseSkeletonProvider{}
}

func NewDockerCLIProvider(host string) ChallengeInstanceProvider {
	return newDockerCLIProvider(host, &execDockerCommandRunner{binary: "docker"})
}

func newDockerCLIProvider(host string, runner dockerCommandRunner) ChallengeInstanceProvider {
	if strings.TrimSpace(host) == "" {
		host = "127.0.0.1"
	}

	return &dockerCLIProvider{
		host:    strings.TrimSpace(host),
		timeout: 30 * time.Second,
		runner:  runner,
	}
}

func (p *leaseSkeletonProvider) EnsureLease(req ChallengeInstanceProviderRequest) (*ChallengeInstanceLeaseState, error) {
	startedAt := req.Now
	if req.Existing != nil && !req.Existing.StartedAt.IsZero() {
		startedAt = req.Existing.StartedAt
	}
	expiresAt := req.Now.Add(req.LeaseDuration)
	if req.Existing != nil && req.Existing.ExpiresAt.After(req.Now) {
		expiresAt = req.Existing.ExpiresAt.Add(req.ExtensionDuration)
	}

	provider := templateChallengeInstanceValue(req.Runtime.Provider, req)
	if provider == "" && req.Existing != nil {
		provider = req.Existing.Provider
	}

	image := templateChallengeInstanceValue(req.Runtime.Image, req)
	if image == "" && req.Existing != nil {
		image = req.Existing.Image
	}

	launchURL := templateChallengeInstanceValue(req.Runtime.LaunchURL, req)
	if launchURL == "" && req.Existing != nil {
		launchURL = req.Existing.LaunchURL
	}

	host := templateChallengeInstanceValue(req.Runtime.Host, req)
	if host == "" && req.Existing != nil {
		host = req.Existing.Host
	}

	port := templateChallengeInstanceValue(req.Runtime.Port, req)
	if port == "" && req.Existing != nil {
		port = req.Existing.Port
	}

	command := templateChallengeInstanceValue(req.Runtime.Command, req)
	if command == "" && req.Existing != nil {
		command = req.Existing.Command
	}

	note := templateChallengeInstanceValue(req.Runtime.Note, req)
	if note == "" && req.Existing != nil {
		note = req.Existing.Note
	}

	return &ChallengeInstanceLeaseState{
		Status:        "running",
		Provider:      provider,
		Image:         image,
		LaunchURL:     launchURL,
		Host:          host,
		Port:          port,
		Command:       command,
		Note:          note,
		StartedAt:     startedAt,
		LastRenewedAt: req.Now,
		ExpiresAt:     expiresAt,
	}, nil
}

func (p *leaseSkeletonProvider) DestroyLease(req ChallengeInstanceProviderRequest) error {
	return nil
}

func (p *dockerCLIProvider) EnsureLease(req ChallengeInstanceProviderRequest) (*ChallengeInstanceLeaseState, error) {
	image := templateChallengeInstanceValue(req.Runtime.Image, req)
	if image == "" {
		return nil, fmt.Errorf("docker provider requires runtime.image")
	}

	provider := templateChallengeInstanceValue(req.Runtime.Provider, req)
	if provider == "" {
		provider = "docker"
	}

	expose := normalizeDockerExposedPorts(req.Runtime.Expose, req.Runtime.Port)
	containerName := dockerInstanceContainerName(req)

	startedAt := req.Now
	if req.Existing != nil && !req.Existing.StartedAt.IsZero() {
		startedAt = req.Existing.StartedAt
	}
	expiresAt := req.Now.Add(req.LeaseDuration)
	if req.Existing != nil && req.Existing.ExpiresAt.After(req.Now) {
		expiresAt = req.Existing.ExpiresAt.Add(req.ExtensionDuration)
	}

	shouldCreate := req.Existing == nil
	if !shouldCreate {
		exists, err := p.containerExists(containerName)
		if err != nil {
			return nil, err
		}
		shouldCreate = !exists
	}

	if shouldCreate {
		args := []string{
			"run", "-d",
			"--name", containerName,
			"--label", "sauryctf.managed=true",
			"--label", fmt.Sprintf("sauryctf.game_id=%d", req.GameID),
			"--label", fmt.Sprintf("sauryctf.challenge_id=%d", req.ChallengeID),
			"--label", fmt.Sprintf("sauryctf.team_id=%d", req.TeamID),
		}
		for _, port := range expose {
			args = append(args, "-p", port)
		}
		for _, envItem := range normalizeDockerEnvArgs(req.Runtime.Env, req) {
			args = append(args, "--env", envItem)
		}
		args = append(args, image)

		if _, err := p.run(args...); err != nil {
			return nil, err
		}
	}

	host := templateChallengeInstanceValue(req.Runtime.Host, req)
	hostProvided := host != ""
	if host == "" {
		host = p.host
	}

	launchURL := templateChallengeInstanceValue(req.Runtime.LaunchURL, req)
	port := templateChallengeInstanceValue(req.Runtime.Port, req)

	if len(expose) > 0 {
		ports, err := p.inspectPorts(containerName)
		if err != nil {
			return nil, err
		}

		primaryKey := dockerPortKey(expose[0])
		if bindings, ok := ports[primaryKey]; ok {
			if resolvedHost, resolvedPort := resolveDockerBindingEndpoint(bindings); resolvedPort != "" {
				port = resolvedPort
				if !hostProvided && resolvedHost != "" {
					host = resolvedHost
				}
			}
		}

		if port != "" && (launchURL == "" || strings.HasPrefix(launchURL, "/")) {
			launchURL = fmt.Sprintf("http://%s:%s", formatDockerLaunchHost(host), port)
		}
	}

	command := templateChallengeInstanceValue(req.Runtime.Command, req)
	if command == "" && req.Existing != nil {
		command = req.Existing.Command
	}

	note := templateChallengeInstanceValue(req.Runtime.Note, req)
	containerNote := fmt.Sprintf("docker container: %s", containerName)
	if note == "" {
		note = containerNote
	} else if !strings.Contains(note, containerName) {
		note = fmt.Sprintf("%s\n%s", note, containerNote)
	}

	return &ChallengeInstanceLeaseState{
		Status:        "running",
		Provider:      provider,
		Image:         image,
		LaunchURL:     launchURL,
		Host:          host,
		Port:          port,
		Command:       command,
		Note:          note,
		StartedAt:     startedAt,
		LastRenewedAt: req.Now,
		ExpiresAt:     expiresAt,
	}, nil
}

func (p *dockerCLIProvider) DestroyLease(req ChallengeInstanceProviderRequest) error {
	containerName := dockerInstanceContainerName(req)
	_, err := p.run("rm", "-f", containerName)
	if err != nil && strings.Contains(err.Error(), "No such container") {
		return nil
	}
	return err
}

func templateChallengeInstanceValue(input string, req ChallengeInstanceProviderRequest) string {
	source := strings.TrimSpace(input)
	if source == "" {
		return ""
	}

	replacer := strings.NewReplacer(
		"{{game_id}}", fmt.Sprintf("%d", req.GameID),
		"{{challenge_id}}", fmt.Sprintf("%d", req.ChallengeID),
		"{{team_id}}", fmt.Sprintf("%d", req.TeamID),
		"{{user_id}}", fmt.Sprintf("%d", req.UserID),
		"{{team_hash}}", challengeInstanceTeamHash(req),
	)

	return replacer.Replace(source)
}

func normalizeDockerExposedPorts(expose []string, fallbackPort string) []string {
	result := make([]string, 0, len(expose)+1)
	for _, item := range expose {
		port := strings.TrimSpace(item)
		if port == "" {
			continue
		}
		result = append(result, port)
	}

	fallbackPort = strings.TrimSpace(fallbackPort)
	if fallbackPort != "" && !strings.Contains(fallbackPort, "{{") {
		hasFallback := false
		for _, item := range result {
			if dockerPortKey(item) == dockerPortKey(fallbackPort) {
				hasFallback = true
				break
			}
		}
		if !hasFallback {
			result = append(result, fallbackPort)
		}
	}

	return result
}

func normalizeDockerEnvArgs(env map[string]string, req ChallengeInstanceProviderRequest) []string {
	if len(env) == 0 {
		return nil
	}

	keys := make([]string, 0, len(env))
	for key := range env {
		normalizedKey := strings.TrimSpace(key)
		if normalizedKey == "" {
			continue
		}
		keys = append(keys, normalizedKey)
	}
	sort.Strings(keys)

	result := make([]string, 0, len(keys))
	for _, key := range keys {
		value := templateChallengeInstanceValue(env[key], req)
		result = append(result, fmt.Sprintf("%s=%s", key, value))
	}
	return result
}

func dockerPortKey(value string) string {
	published := strings.TrimSpace(value)
	if published == "" {
		return ""
	}

	parts := strings.Split(published, ":")
	containerPort := strings.TrimSpace(parts[len(parts)-1])
	if containerPort == "" {
		return ""
	}

	if strings.Contains(containerPort, "/") {
		return containerPort
	}

	return containerPort + "/tcp"
}

func resolveDockerBindingEndpoint(bindings []dockerPortBinding) (string, string) {
	for _, binding := range bindings {
		hostPort := strings.TrimSpace(binding.HostPort)
		if hostPort == "" {
			continue
		}

		hostIP := normalizeDockerBindingHost(binding.HostIP)
		return hostIP, hostPort
	}

	return "", ""
}

func normalizeDockerBindingHost(host string) string {
	normalized := strings.TrimSpace(host)
	switch normalized {
	case "", "0.0.0.0", "::":
		return ""
	default:
		return normalized
	}
}

func formatDockerLaunchHost(host string) string {
	trimmed := strings.TrimSpace(host)
	if trimmed == "" {
		return ""
	}
	if strings.Contains(trimmed, ":") && !strings.HasPrefix(trimmed, "[") && !strings.HasSuffix(trimmed, "]") {
		return "[" + trimmed + "]"
	}
	return trimmed
}

func challengeInstanceTeamHash(req ChallengeInstanceProviderRequest) string {
	// Keep the current local implementation deterministic while aligning the
	// visible team-hash format with the 12-char middle-slice style used by
	// mature CTF platforms. We still derive it from local IDs because this
	// project does not yet issue signed team tokens or per-game hash salts.
	sum := sha256.Sum256([]byte(fmt.Sprintf("sauryctf:%d:%d:%d", req.GameID, req.ChallengeID, req.TeamID)))
	return hex.EncodeToString(sum[:])[12:24]
}

func dockerInstanceContainerName(req ChallengeInstanceProviderRequest) string {
	return fmt.Sprintf(
		"sauryctf-g%d-c%d-t%d-%s",
		req.GameID,
		req.ChallengeID,
		req.TeamID,
		challengeInstanceTeamHash(req),
	)
}

func defaultChallengeInstanceProviders() map[string]ChallengeInstanceProvider {
	skeleton := NewLeaseSkeletonProvider()
	return map[string]ChallengeInstanceProvider{
		"":              skeleton,
		"docker":        skeleton,
		"k8s":           skeleton,
		"kubernetes":    skeleton,
		"proxy":         skeleton,
		"platformproxy": skeleton,
	}
}

func cloneChallengeInstanceProviders(providers map[string]ChallengeInstanceProvider) map[string]ChallengeInstanceProvider {
	cloned := defaultChallengeInstanceProviders()
	for key, provider := range providers {
		name := strings.ToLower(strings.TrimSpace(key))
		if provider == nil {
			continue
		}
		cloned[name] = provider
	}
	return cloned
}

func resolveChallengeInstanceProvider(providers map[string]ChallengeInstanceProvider, name string) ChallengeInstanceProvider {
	key := strings.ToLower(strings.TrimSpace(name))
	if provider, ok := providers[key]; ok && provider != nil {
		return provider
	}

	if provider, ok := providers[""]; ok && provider != nil {
		return provider
	}

	return NewLeaseSkeletonProvider()
}

func applyLeaseState(lease *models.GameInstanceLease, state *ChallengeInstanceLeaseState, userID uint) {
	lease.Status = state.Status
	lease.UserID = userID
	lease.Provider = state.Provider
	lease.Image = state.Image
	lease.LaunchURL = state.LaunchURL
	lease.Host = state.Host
	lease.Port = state.Port
	lease.Command = state.Command
	lease.Note = state.Note
	lease.StartedAt = state.StartedAt
	lease.LastRenewedAt = state.LastRenewedAt
	lease.ExpiresAt = state.ExpiresAt
	lease.StoppedAt = nil
}

func (p *dockerCLIProvider) run(args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), p.timeout)
	defer cancel()

	output, err := p.runner.Run(ctx, args...)
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return nil, fmt.Errorf("docker %s failed: %s", strings.Join(args, " "), message)
	}
	return output, nil
}

func (p *dockerCLIProvider) containerExists(containerName string) (bool, error) {
	_, err := p.run("inspect", containerName)
	if err != nil {
		if strings.Contains(err.Error(), "No such object") || strings.Contains(err.Error(), "No such container") {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (p *dockerCLIProvider) inspectPorts(containerName string) (map[string][]dockerPortBinding, error) {
	output, err := p.run("inspect", "--format", "{{json .NetworkSettings.Ports}}", containerName)
	if err != nil {
		return nil, err
	}

	var ports map[string][]dockerPortBinding
	if err := json.Unmarshal(output, &ports); err != nil {
		return nil, fmt.Errorf("docker inspect port parsing failed: %w", err)
	}
	return ports, nil
}
