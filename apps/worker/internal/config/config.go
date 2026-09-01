package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	defaultHealthAddress        = ":8081"
	defaultExpectedDatabaseRole = "sauryctf_worker"
	defaultMaxConnections       = int32(10)
	defaultConnectTimeout       = 5 * time.Second
	defaultReadinessTimeout     = 2 * time.Second
	defaultShutdownTimeout      = 15 * time.Second
)

var (
	workerIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)
	rolePattern     = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}$`)
)

// Config is the complete process configuration for the private instance worker.
// It deliberately uses a dedicated database URL instead of the control-plane URL.
type Config struct {
	WorkerID               string
	DatabaseURL            string
	ExpectedDatabaseRole   string
	DatabaseMaxConnections int32
	DatabaseConnectTimeout time.Duration
	HealthAddress          string
	ReadinessTimeout       time.Duration
	ShutdownTimeout        time.Duration
}

// Load reads and validates Worker configuration without opening external connections.
func Load(getenv func(string) string) (Config, error) {
	workerID := strings.TrimSpace(getenv("WORKER_ID"))
	databaseURL := strings.TrimSpace(getenv("WORKER_DATABASE_URL"))
	expectedRole := valueOrDefault(getenv("WORKER_DATABASE_EXPECTED_ROLE"), defaultExpectedDatabaseRole)
	healthAddress := valueOrDefault(getenv("WORKER_HEALTH_ADDRESS"), defaultHealthAddress)

	var problems []error
	if !workerIDPattern.MatchString(workerID) {
		problems = append(problems, errors.New("WORKER_ID must contain 1-128 safe identifier characters"))
	}
	if err := validateDatabaseURL(databaseURL); err != nil {
		problems = append(problems, err)
	}
	if !rolePattern.MatchString(expectedRole) {
		problems = append(problems, errors.New("WORKER_DATABASE_EXPECTED_ROLE must be a lowercase PostgreSQL role identifier"))
	}
	if err := validateAddress(healthAddress); err != nil {
		problems = append(problems, err)
	}

	maxConnections, err := boundedInt32(getenv("WORKER_DATABASE_MAX_CONNECTIONS"), defaultMaxConnections, 1, 100)
	if err != nil {
		problems = append(problems, fmt.Errorf("WORKER_DATABASE_MAX_CONNECTIONS: %w", err))
	}
	connectTimeout, err := boundedDuration(getenv("WORKER_DATABASE_CONNECT_TIMEOUT"), defaultConnectTimeout, time.Second, 30*time.Second)
	if err != nil {
		problems = append(problems, fmt.Errorf("WORKER_DATABASE_CONNECT_TIMEOUT: %w", err))
	}
	readinessTimeout, err := boundedDuration(getenv("WORKER_READINESS_TIMEOUT"), defaultReadinessTimeout, 100*time.Millisecond, 10*time.Second)
	if err != nil {
		problems = append(problems, fmt.Errorf("WORKER_READINESS_TIMEOUT: %w", err))
	}
	shutdownTimeout, err := boundedDuration(getenv("WORKER_SHUTDOWN_TIMEOUT"), defaultShutdownTimeout, time.Second, 2*time.Minute)
	if err != nil {
		problems = append(problems, fmt.Errorf("WORKER_SHUTDOWN_TIMEOUT: %w", err))
	}
	if err := errors.Join(problems...); err != nil {
		return Config{}, err
	}

	return Config{
		WorkerID:               workerID,
		DatabaseURL:            databaseURL,
		ExpectedDatabaseRole:   expectedRole,
		DatabaseMaxConnections: maxConnections,
		DatabaseConnectTimeout: connectTimeout,
		HealthAddress:          healthAddress,
		ReadinessTimeout:       readinessTimeout,
		ShutdownTimeout:        shutdownTimeout,
	}, nil
}

func validateDatabaseURL(value string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "postgres" && parsed.Scheme != "postgresql" || parsed.Host == "" || parsed.Path == "" || parsed.Path == "/" {
		return errors.New("WORKER_DATABASE_URL must be a PostgreSQL URL with host and database name")
	}
	if parsed.User == nil || parsed.User.Username() == "" {
		return errors.New("WORKER_DATABASE_URL must identify a dedicated login role")
	}
	return nil
}

func validateAddress(value string) error {
	_, port, err := net.SplitHostPort(value)
	if err != nil {
		return errors.New("WORKER_HEALTH_ADDRESS must be a host:port listen address")
	}
	numericPort, err := strconv.Atoi(port)
	if err != nil || numericPort < 1 || numericPort > 65535 {
		return errors.New("WORKER_HEALTH_ADDRESS port must be between 1 and 65535")
	}
	return nil
}

func boundedInt32(raw string, fallback, minimum, maximum int32) (int32, error) {
	if strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	value, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 32)
	if err != nil || value < int64(minimum) || value > int64(maximum) {
		return 0, fmt.Errorf("must be an integer from %d to %d", minimum, maximum)
	}
	return int32(value), nil
}

func boundedDuration(raw string, fallback, minimum, maximum time.Duration) (time.Duration, error) {
	if strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	value, err := time.ParseDuration(strings.TrimSpace(raw))
	if err != nil || value < minimum || value > maximum {
		return 0, fmt.Errorf("must be a duration from %s to %s", minimum, maximum)
	}
	return value, nil
}

func valueOrDefault(raw, fallback string) string {
	if value := strings.TrimSpace(raw); value != "" {
		return value
	}
	return fallback
}
