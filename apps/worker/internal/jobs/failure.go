package jobs

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
)

type FailureKind string

const (
	FailureRetryable FailureKind = "retryable"
	FailurePermanent FailureKind = "permanent"
	FailureCancelled FailureKind = "cancelled"
)

const (
	defaultRetryableCode    = "provider.retryable"
	defaultRetryableSummary = "Provider operation failed and may be retried"
	defaultTimeoutCode      = "provider.timeout"
	defaultTimeoutSummary   = "Provider operation timed out"
)

var failureCodePattern = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,127}$`)

// ExecutionError carries a safe, persistent classification while retaining an
// optional internal cause for errors.Is/errors.As. Cause text is never written
// to the queue or attempts table.
type ExecutionError struct {
	Kind    FailureKind
	Code    string
	Summary string
	Cause   error
}

func (failure *ExecutionError) Error() string {
	return failure.Summary
}

func (failure *ExecutionError) Unwrap() error {
	return failure.Cause
}

func RetryableError(code, summary string, cause error) error {
	return &ExecutionError{Kind: FailureRetryable, Code: code, Summary: summary, Cause: cause}
}

func PermanentError(code, summary string, cause error) error {
	return &ExecutionError{Kind: FailurePermanent, Code: code, Summary: summary, Cause: cause}
}

func CancelledError(code, summary string, cause error) error {
	return &ExecutionError{Kind: FailureCancelled, Code: code, Summary: summary, Cause: cause}
}

type Failure struct {
	Kind    FailureKind
	Code    string
	Summary string
}

func ClassifyFailure(err error) Failure {
	var executionError *ExecutionError
	if errors.As(err, &executionError) && validFailure(executionError.Kind, executionError.Code, executionError.Summary) {
		return Failure{
			Kind:    executionError.Kind,
			Code:    executionError.Code,
			Summary: strings.TrimSpace(executionError.Summary),
		}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return Failure{Kind: FailureRetryable, Code: defaultTimeoutCode, Summary: defaultTimeoutSummary}
	}
	return Failure{Kind: FailureRetryable, Code: defaultRetryableCode, Summary: defaultRetryableSummary}
}

func normalizeFailure(failure Failure) Failure {
	if validFailure(failure.Kind, failure.Code, failure.Summary) {
		failure.Summary = strings.TrimSpace(failure.Summary)
		return failure
	}
	return Failure{Kind: FailureRetryable, Code: defaultRetryableCode, Summary: defaultRetryableSummary}
}

func validFailure(kind FailureKind, code, summary string) bool {
	if kind != FailureRetryable && kind != FailurePermanent && kind != FailureCancelled {
		return false
	}
	return failureCodePattern.MatchString(code) && strings.TrimSpace(summary) != "" && len(summary) <= 1024
}

type RetryPolicy struct {
	InitialDelay time.Duration
	MaxDelay     time.Duration
}

func (policy RetryPolicy) Delay(attemptNumber int) time.Duration {
	if attemptNumber <= 1 || policy.InitialDelay >= policy.MaxDelay {
		return min(policy.InitialDelay, policy.MaxDelay)
	}
	delay := policy.InitialDelay
	for step := 1; step < attemptNumber; step++ {
		if delay >= policy.MaxDelay/2 {
			return policy.MaxDelay
		}
		delay *= 2
	}
	return min(delay, policy.MaxDelay)
}
