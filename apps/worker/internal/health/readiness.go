package health

import (
	"context"
	"errors"
	"fmt"
)

type ReadinessGroup struct {
	checks []Readiness
}

func NewReadinessGroup(checks ...Readiness) (*ReadinessGroup, error) {
	if len(checks) == 0 {
		return nil, errors.New("readiness group requires at least one check")
	}
	for _, check := range checks {
		if check == nil {
			return nil, errors.New("readiness check must not be nil")
		}
	}
	return &ReadinessGroup{checks: append([]Readiness(nil), checks...)}, nil
}

func (group *ReadinessGroup) Ready(ctx context.Context) error {
	for index, check := range group.checks {
		if err := check.Ready(ctx); err != nil {
			return fmt.Errorf("readiness check %d: %w", index+1, err)
		}
	}
	return nil
}
