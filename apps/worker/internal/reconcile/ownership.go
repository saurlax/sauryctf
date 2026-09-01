// Package reconcile compares authoritative instance intent with provider resources.
package reconcile

import (
	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
)

const (
	LabelPlatform   = providers.LabelPlatform
	LabelContest    = providers.LabelContest
	LabelChallenge  = providers.LabelChallenge
	LabelTeam       = providers.LabelTeam
	LabelInstance   = providers.LabelInstance
	LabelGeneration = providers.LabelGeneration
)

var (
	ErrUnmanagedResource = providers.ErrUnmanagedResource
	ErrIncompleteLabels  = providers.ErrIncompleteLabels
)

type Ownership providers.InstanceKey

func ParseOwnership(labels map[string]string, platformID string, provider contracts.InstanceProvider) (Ownership, error) {
	key, err := providers.ParseInstanceKey(labels, platformID, provider)
	return Ownership(key), err
}

func (ownership Ownership) Labels() map[string]string {
	return providers.InstanceKey(ownership).Labels()
}

func (ownership Ownership) identityKey() string {
	return providers.InstanceKey(ownership).IdentityKey()
}
