package jobs

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestClassifyFailureKeepsOnlyValidatedSafeMetadata(t *testing.T) {
	cause := errors.New("registry secret must never be persisted")
	tests := []struct {
		name string
		err  error
		want Failure
	}{
		{
			name: "retryable",
			err:  RetryableError("provider.unavailable", "Provider is temporarily unavailable", cause),
			want: Failure{Kind: FailureRetryable, Code: "provider.unavailable", Summary: "Provider is temporarily unavailable"},
		},
		{
			name: "permanent",
			err:  PermanentError("provider.image_missing", "Configured image does not exist", cause),
			want: Failure{Kind: FailurePermanent, Code: "provider.image_missing", Summary: "Configured image does not exist"},
		},
		{
			name: "cancelled",
			err:  CancelledError("job.cancelled", "The requested operation was cancelled", cause),
			want: Failure{Kind: FailureCancelled, Code: "job.cancelled", Summary: "The requested operation was cancelled"},
		},
		{
			name: "timeout",
			err:  context.DeadlineExceeded,
			want: Failure{Kind: FailureRetryable, Code: defaultTimeoutCode, Summary: defaultTimeoutSummary},
		},
		{
			name: "unknown",
			err:  cause,
			want: Failure{Kind: FailureRetryable, Code: defaultRetryableCode, Summary: defaultRetryableSummary},
		},
		{
			name: "invalid metadata",
			err:  PermanentError("BAD CODE", "unsafe", cause),
			want: Failure{Kind: FailureRetryable, Code: defaultRetryableCode, Summary: defaultRetryableSummary},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := ClassifyFailure(test.err); got != test.want {
				t.Fatalf("ClassifyFailure() = %+v, want %+v", got, test.want)
			}
			if got := ClassifyFailure(test.err); got.Summary == cause.Error() {
				t.Fatal("ClassifyFailure() persisted internal cause text")
			}
		})
	}
}

func TestRetryPolicyUsesCappedExponentialDelay(t *testing.T) {
	policy := RetryPolicy{InitialDelay: time.Second, MaxDelay: 5 * time.Second}
	want := []time.Duration{time.Second, 2 * time.Second, 4 * time.Second, 5 * time.Second, 5 * time.Second}
	for index, expected := range want {
		if actual := policy.Delay(index + 1); actual != expected {
			t.Fatalf("Delay(%d) = %s, want %s", index+1, actual, expected)
		}
	}
}
