package health

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type readinessStub struct {
	err error
}

func (stub readinessStub) Ready(context.Context) error {
	return stub.err
}

type readinessFunc func(context.Context) error

func (ready readinessFunc) Ready(ctx context.Context) error {
	return ready(ctx)
}

func TestLivenessDoesNotDependOnReadiness(t *testing.T) {
	handler := NewHandler(readinessStub{err: errors.New("database credentials must stay private")}, time.Second)
	response := performRequest(handler, http.MethodGet, "/health/live")
	if response.Code != http.StatusOK || response.Body.String() != "{\"status\":\"ok\",\"component\":\"instance-worker\"}\n" {
		t.Fatalf("unexpected liveness response: %d %s", response.Code, response.Body.String())
	}
	assertPrivateProbeHeaders(t, response)
}

func TestReadinessReportsOnlySanitizedState(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		statusCode int
		status     string
	}{
		{name: "ready", statusCode: http.StatusOK, status: "ready"},
		{name: "not ready", err: errors.New("postgresql://worker:secret@database"), statusCode: http.StatusServiceUnavailable, status: "not_ready"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler := NewHandler(readinessStub{err: test.err}, time.Second)
			response := performRequest(handler, http.MethodGet, "/health/ready")
			if response.Code != test.statusCode || !strings.Contains(response.Body.String(), `"status":"`+test.status+`"`) {
				t.Fatalf("unexpected readiness response: %d %s", response.Code, response.Body.String())
			}
			if strings.Contains(response.Body.String(), "secret") || strings.Contains(response.Body.String(), "postgresql") {
				t.Fatalf("readiness leaked internal error: %s", response.Body.String())
			}
			assertPrivateProbeHeaders(t, response)
		})
	}
}

func TestReadinessUsesItsOwnShortDeadline(t *testing.T) {
	deadlineObserved := make(chan struct{}, 1)
	handler := NewHandler(readinessFunc(func(ctx context.Context) error {
		<-ctx.Done()
		deadlineObserved <- struct{}{}
		return ctx.Err()
	}), 10*time.Millisecond)

	response := performRequest(handler, http.MethodGet, "/health/ready")
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("readiness response = %d, want 503", response.Code)
	}
	select {
	case <-deadlineObserved:
	case <-time.After(time.Second):
		t.Fatal("readiness did not receive its configured deadline")
	}
}

func TestHandlerHasNoPublicBusinessRoutes(t *testing.T) {
	handler := NewHandler(readinessStub{}, time.Second)
	segments := [][]string{
		{"api", "auth", "login"},
		{"api", "users"},
		{"api", "teams"},
		{"api", "contests"},
		{"api", "submissions"},
		{"api", "scoreboards"},
		{"api", "admin"},
	}
	for _, parts := range segments {
		route := "/" + strings.Join(parts, "/")
		if response := performRequest(handler, http.MethodGet, route); response.Code != http.StatusNotFound {
			t.Errorf("GET %s returned %d, want 404", route, response.Code)
		}
	}
}

func TestHealthRoutesRejectStateChangingMethods(t *testing.T) {
	handler := NewHandler(readinessStub{}, time.Second)
	response := performRequest(handler, http.MethodPost, "/health/live")
	if response.Code != http.StatusMethodNotAllowed || response.Header().Get("Allow") != http.MethodGet {
		t.Fatalf("unexpected method response: %d headers=%v", response.Code, response.Header())
	}
}

func TestPrivateMetricsRouteIsReadOnlyAndDoesNotChangeHealthPayloads(t *testing.T) {
	metrics := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/plain")
		_, _ = writer.Write([]byte("sauryctf_worker_instance_job_attempts_total 1\n"))
	})
	handler := NewHandler(readinessStub{}, time.Second, metrics)
	response := performRequest(handler, http.MethodGet, "/metrics")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "instance_job_attempts") {
		t.Fatalf("unexpected metrics response: %d %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("metrics Cache-Control = %q", response.Header().Get("Cache-Control"))
	}
	if response := performRequest(handler, http.MethodPost, "/metrics"); response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST /metrics returned %d", response.Code)
	}
}

func performRequest(handler http.Handler, method, route string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, route, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func assertPrivateProbeHeaders(t *testing.T, response *httptest.ResponseRecorder) {
	t.Helper()
	if response.Header().Get("Content-Type") != "application/json" {
		t.Errorf("Content-Type = %q", response.Header().Get("Content-Type"))
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control = %q", response.Header().Get("Cache-Control"))
	}
}
