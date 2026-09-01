// Package providers defines the shared dynamic-instance lifecycle contract.
package providers

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
)

const (
	LabelPlatform   = "sauryctf.io/managed-by"
	LabelContest    = "sauryctf.io/contest-id"
	LabelChallenge  = "sauryctf.io/challenge-id"
	LabelTeam       = "sauryctf.io/team-id"
	LabelInstance   = "sauryctf.io/instance-id"
	LabelGeneration = "sauryctf.io/generation"
)

var (
	ErrUnmanagedResource = errors.New("resource is not owned by this platform")
	ErrIncompleteLabels  = errors.New("resource ownership labels are incomplete or invalid")
	ErrProviderNotFound  = errors.New("instance provider is not registered")
	platformIDPattern    = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9.-]{0,61}[a-z0-9])?$`)
	resourceNamePattern  = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
)

type InstanceKey struct {
	Platform   string
	Provider   contracts.InstanceProvider
	Contest    contracts.UUID
	Challenge  contracts.UUID
	Team       contracts.UUID
	Instance   contracts.UUID
	Generation contracts.ResourceVersion
}

func (key InstanceKey) Validate() error {
	if !platformIDPattern.MatchString(key.Platform) {
		return errors.New("platform id must be a lowercase label value of at most 63 characters")
	}
	if err := key.Provider.Validate(); err != nil {
		return err
	}
	for name, value := range map[string]contracts.UUID{
		"contest": key.Contest, "challenge": key.Challenge,
		"team": key.Team, "instance": key.Instance,
	} {
		if err := value.Validate(); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}
	if err := key.Generation.Validate(); err != nil {
		return fmt.Errorf("generation: %w", err)
	}
	return nil
}

func (key InstanceKey) Labels() map[string]string {
	return map[string]string{
		LabelPlatform:   key.Platform,
		LabelContest:    string(key.Contest),
		LabelChallenge:  string(key.Challenge),
		LabelTeam:       string(key.Team),
		LabelInstance:   string(key.Instance),
		LabelGeneration: strconv.FormatUint(uint64(key.Generation), 10),
	}
}

func (key InstanceKey) IdentityKey() string {
	return string(key.Provider) + "/" + string(key.Instance) + "/" + strconv.FormatUint(uint64(key.Generation), 10)
}

// ResourceName is stable across retries and valid for Docker container names
// and Kubernetes DNS labels. A deployment hash plus the full UUID prevents
// cross-platform and truncated-prefix collisions.
func (key InstanceKey) ResourceName() (string, error) {
	if err := key.Validate(); err != nil {
		return "", err
	}
	platformHash := sha256.Sum256([]byte(key.Platform))
	name := fmt.Sprintf("s-%x-%s-g%d", platformHash[:5], strings.ReplaceAll(string(key.Instance), "-", ""), key.Generation)
	if len(name) > 63 || !resourceNamePattern.MatchString(name) {
		return "", errors.New("deterministic resource name is not a DNS label")
	}
	return name, nil
}

func ParseInstanceKey(labels map[string]string, platformID string, provider contracts.InstanceProvider) (InstanceKey, error) {
	if labels[LabelPlatform] != platformID {
		return InstanceKey{}, ErrUnmanagedResource
	}
	key := InstanceKey{
		Platform: platformID, Provider: provider,
		Contest: contracts.UUID(labels[LabelContest]), Challenge: contracts.UUID(labels[LabelChallenge]),
		Team: contracts.UUID(labels[LabelTeam]), Instance: contracts.UUID(labels[LabelInstance]),
	}
	for name, value := range map[string]contracts.UUID{
		LabelContest: key.Contest, LabelChallenge: key.Challenge,
		LabelTeam: key.Team, LabelInstance: key.Instance,
	} {
		if err := value.Validate(); err != nil {
			return InstanceKey{}, fmt.Errorf("%w: %s", ErrIncompleteLabels, name)
		}
	}
	generation, err := strconv.ParseUint(labels[LabelGeneration], 10, 64)
	if err != nil {
		return InstanceKey{}, fmt.Errorf("%w: %s", ErrIncompleteLabels, LabelGeneration)
	}
	key.Generation = contracts.ResourceVersion(generation)
	if err := key.Validate(); err != nil {
		return InstanceKey{}, fmt.Errorf("%w: %v", ErrIncompleteLabels, err)
	}
	return key, nil
}

type InstanceSpec struct {
	Key       InstanceKey
	Runtime   contracts.InstanceRuntimeSpec
	ExpiresAt *time.Time
}

func (spec InstanceSpec) Validate() error {
	if err := spec.Key.Validate(); err != nil {
		return fmt.Errorf("key: %w", err)
	}
	if err := spec.Runtime.Validate(); err != nil {
		return fmt.Errorf("runtime: %w", err)
	}
	if spec.ExpiresAt != nil && spec.ExpiresAt.IsZero() {
		return errors.New("expires_at must not be zero")
	}
	return nil
}

type Resource struct {
	Provider   contracts.InstanceProvider
	ResourceID string
	Labels     map[string]string
}

func (resource Resource) Validate() error {
	if err := resource.Provider.Validate(); err != nil {
		return err
	}
	if resource.ResourceID == "" || len(resource.ResourceID) > 255 || strings.TrimSpace(resource.ResourceID) != resource.ResourceID {
		return errors.New("resource id must contain 1-255 trimmed characters")
	}
	return nil
}

// Provider has one declarative lifecycle across every runtime. Destroy MUST
// return a stopped observation when the deterministic resource is already absent.
type Provider interface {
	Kind() contracts.InstanceProvider
	Ensure(context.Context, InstanceSpec) (jobs.Observation, error)
	Inspect(context.Context, InstanceKey) (jobs.Observation, error)
	Destroy(context.Context, InstanceKey) (jobs.Observation, error)
	List(context.Context, string) ([]Resource, error)
}

// Backend is the multi-provider surface consumed by the job processor and reconciler.
type Backend interface {
	Ensure(context.Context, InstanceSpec) (jobs.Observation, error)
	Inspect(context.Context, InstanceKey) (jobs.Observation, error)
	Destroy(context.Context, InstanceKey) (jobs.Observation, error)
	ListResources(context.Context) ([]Resource, error)
}
