package games

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
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

func challengeInstanceTeamHash(req ChallengeInstanceProviderRequest) string {
	sum := sha1.Sum([]byte(fmt.Sprintf("%d:%d:%d", req.GameID, req.ChallengeID, req.TeamID)))
	return hex.EncodeToString(sum[:6])
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
