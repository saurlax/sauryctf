// Package reconcile compares authoritative instance intent with provider resources.
package reconcile

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
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
)

type Ownership struct {
	Platform   string
	Contest    contracts.UUID
	Challenge  contracts.UUID
	Team       contracts.UUID
	Instance   contracts.UUID
	Generation contracts.ResourceVersion
}

func ParseOwnership(labels map[string]string, platformID string) (Ownership, error) {
	if labels[LabelPlatform] != platformID {
		return Ownership{}, ErrUnmanagedResource
	}
	ownership := Ownership{
		Platform:  platformID,
		Contest:   contracts.UUID(labels[LabelContest]),
		Challenge: contracts.UUID(labels[LabelChallenge]),
		Team:      contracts.UUID(labels[LabelTeam]),
		Instance:  contracts.UUID(labels[LabelInstance]),
	}
	for name, value := range map[string]contracts.UUID{
		LabelContest:   ownership.Contest,
		LabelChallenge: ownership.Challenge,
		LabelTeam:      ownership.Team,
		LabelInstance:  ownership.Instance,
	} {
		if err := value.Validate(); err != nil {
			return Ownership{}, fmt.Errorf("%w: %s", ErrIncompleteLabels, name)
		}
	}
	generation, err := strconv.ParseUint(labels[LabelGeneration], 10, 64)
	if err != nil {
		return Ownership{}, fmt.Errorf("%w: %s", ErrIncompleteLabels, LabelGeneration)
	}
	ownership.Generation = contracts.ResourceVersion(generation)
	if err := ownership.Generation.Validate(); err != nil {
		return Ownership{}, fmt.Errorf("%w: %s", ErrIncompleteLabels, LabelGeneration)
	}
	return ownership, nil
}

func (ownership Ownership) Labels() map[string]string {
	return map[string]string{
		LabelPlatform:   ownership.Platform,
		LabelContest:    string(ownership.Contest),
		LabelChallenge:  string(ownership.Challenge),
		LabelTeam:       string(ownership.Team),
		LabelInstance:   string(ownership.Instance),
		LabelGeneration: strconv.FormatUint(uint64(ownership.Generation), 10),
	}
}

func (ownership Ownership) identityKey(provider contracts.InstanceProvider) string {
	return string(provider) + "/" + string(ownership.Instance) + "/" + strconv.FormatUint(uint64(ownership.Generation), 10)
}
