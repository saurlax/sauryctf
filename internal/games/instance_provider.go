package games

import (
	"strings"

	"github.com/saurlax/sauryctf/internal/models"
)

type leaseSkeletonProvider struct{}

func NewLeaseSkeletonProvider() ChallengeInstanceProvider {
	return &leaseSkeletonProvider{}
}

func (p *leaseSkeletonProvider) EnsureLease(req ChallengeInstanceProviderRequest) (*ChallengeInstanceLeaseState, error) {
	startedAt := req.Now
	if req.Existing != nil && !req.Existing.StartedAt.IsZero() {
		startedAt = req.Existing.StartedAt
	}

	provider := strings.TrimSpace(req.Runtime.Provider)
	if provider == "" && req.Existing != nil {
		provider = req.Existing.Provider
	}

	image := strings.TrimSpace(req.Runtime.Image)
	if image == "" && req.Existing != nil {
		image = req.Existing.Image
	}

	launchURL := strings.TrimSpace(req.Runtime.LaunchURL)
	if launchURL == "" && req.Existing != nil {
		launchURL = req.Existing.LaunchURL
	}

	host := strings.TrimSpace(req.Runtime.Host)
	if host == "" && req.Existing != nil {
		host = req.Existing.Host
	}

	port := strings.TrimSpace(req.Runtime.Port)
	if port == "" && req.Existing != nil {
		port = req.Existing.Port
	}

	command := strings.TrimSpace(req.Runtime.Command)
	if command == "" && req.Existing != nil {
		command = req.Existing.Command
	}

	note := strings.TrimSpace(req.Runtime.Note)
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
		ExpiresAt:     req.Now.Add(req.LeaseDuration),
	}, nil
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
