// Package health exposes the instance worker's private liveness and readiness
// probes. It intentionally has no business routes.
package health

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

const component = "instance-worker"

type Readiness interface {
	Ready(context.Context) error
}

type response struct {
	Status    string `json:"status"`
	Component string `json:"component"`
}

func NewHandler(readiness Readiness, readinessTimeout time.Duration) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/health/live", getOnly(func(writer http.ResponseWriter, _ *http.Request) {
		writeJSON(writer, http.StatusOK, "ok")
	}))
	mux.Handle("/health/ready", getOnly(func(writer http.ResponseWriter, request *http.Request) {
		ctx, cancel := context.WithTimeout(request.Context(), readinessTimeout)
		defer cancel()
		if err := readiness.Ready(ctx); err != nil {
			writeJSON(writer, http.StatusServiceUnavailable, "not_ready")
			return
		}
		writeJSON(writer, http.StatusOK, "ready")
	}))
	return mux
}

func getOnly(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			writer.Header().Set("Allow", http.MethodGet)
			http.Error(writer, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		next(writer, request)
	})
}

func writeJSON(writer http.ResponseWriter, statusCode int, status string) {
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(statusCode)
	_ = json.NewEncoder(writer).Encode(response{Status: status, Component: component})
}
