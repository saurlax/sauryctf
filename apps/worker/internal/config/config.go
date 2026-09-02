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

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/secrets"
)

const (
	defaultHealthAddress        = ":8081"
	defaultExpectedDatabaseRole = "sauryctf_worker"
	defaultMaxConnections       = int32(10)
	defaultConnectTimeout       = 5 * time.Second
	defaultReadinessTimeout     = 2 * time.Second
	defaultShutdownTimeout      = 15 * time.Second
	defaultClaimBatchSize       = 16
	defaultJobConcurrency       = 16
	defaultLeaseDuration        = 30 * time.Second
	defaultLeaseRenewInterval   = 10 * time.Second
	defaultPollInterval         = time.Second
	defaultReconcileInterval    = 30 * time.Second
	defaultOperationTimeout     = 5 * time.Minute
	defaultRetryInitialDelay    = time.Second
	defaultRetryMaxDelay        = time.Minute
	defaultDockerEndpoint       = "unix:///var/run/docker.sock"
	defaultDockerAPIVersion     = "v1.47"
	defaultKubernetesNamespace  = "sauryctf-instances"
)

var (
	workerIDPattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)
	platformIDPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9.-]{0,61}[a-z0-9])?$`)
	rolePattern       = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}$`)
)

// Config is the complete process configuration for the private instance worker.
// It deliberately uses a dedicated database URL instead of the control-plane URL.
type Config struct {
	WorkerID               string
	PlatformID             string
	DatabaseURL            string
	ExpectedDatabaseRole   string
	DatabaseMaxConnections int32
	DatabaseConnectTimeout time.Duration
	HealthAddress          string
	ReadinessTimeout       time.Duration
	ShutdownTimeout        time.Duration
	ClaimBatchSize         int
	JobConcurrency         int
	LeaseDuration          time.Duration
	LeaseRenewInterval     time.Duration
	PollInterval           time.Duration
	ReconcileInterval      time.Duration
	OperationTimeout       time.Duration
	RetryInitialDelay      time.Duration
	RetryMaxDelay          time.Duration
	InstanceSecretKeyring  *secrets.Keyring
	EnabledProviders       []contracts.InstanceProvider
	DockerEndpoint         string
	DockerAPIVersion       string
	DockerPublicHost       string
	KubernetesNamespace    string
	KubernetesHTTPDomain   string
	KubernetesIngressClass string
	KubernetesTLSSecret    string
	KubernetesTCPPortStart int32
	KubernetesLBClass      string
}

// Load reads and validates Worker configuration without opening external connections.
func Load(getenv func(string) string) (Config, error) {
	workerID := strings.TrimSpace(getenv("WORKER_ID"))
	platformID := valueOrDefault(getenv("WORKER_PLATFORM_ID"), "sauryctf")
	databaseURL := strings.TrimSpace(getenv("WORKER_DATABASE_URL"))
	expectedRole := valueOrDefault(getenv("WORKER_DATABASE_EXPECTED_ROLE"), defaultExpectedDatabaseRole)
	healthAddress := valueOrDefault(getenv("WORKER_HEALTH_ADDRESS"), defaultHealthAddress)

	var problems []error
	if !workerIDPattern.MatchString(workerID) {
		problems = append(problems, errors.New("WORKER_ID must contain 1-128 safe identifier characters"))
	}
	if !platformIDPattern.MatchString(platformID) {
		problems = append(problems, errors.New("WORKER_PLATFORM_ID must be a lowercase label value of at most 63 characters"))
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
	claimBatchSize, err := boundedInt(getenv("WORKER_CLAIM_BATCH_SIZE"), defaultClaimBatchSize, 1, 100)
	if err != nil {
		problems = append(problems, fmt.Errorf("WORKER_CLAIM_BATCH_SIZE: %w", err))
	}
	jobConcurrency, err := boundedInt(getenv("WORKER_JOB_CONCURRENCY"), defaultJobConcurrency, 1, 100)
	if err != nil {
		problems = append(problems, fmt.Errorf("WORKER_JOB_CONCURRENCY: %w", err))
	}
	leaseDuration, err := boundedDuration(getenv("WORKER_LEASE_DURATION"), defaultLeaseDuration, 5*time.Second, 5*time.Minute)
	if err != nil {
		problems = append(problems, fmt.Errorf("WORKER_LEASE_DURATION: %w", err))
	}
	leaseRenewInterval, err := boundedDuration(getenv("WORKER_LEASE_RENEW_INTERVAL"), defaultLeaseRenewInterval, time.Second, time.Minute)
	if err != nil {
		problems = append(problems, fmt.Errorf("WORKER_LEASE_RENEW_INTERVAL: %w", err))
	}
	pollInterval, err := boundedDuration(getenv("WORKER_POLL_INTERVAL"), defaultPollInterval, 50*time.Millisecond, 30*time.Second)
	if err != nil {
		problems = append(problems, fmt.Errorf("WORKER_POLL_INTERVAL: %w", err))
	}
	reconcileInterval, err := boundedDuration(getenv("WORKER_RECONCILE_INTERVAL"), defaultReconcileInterval, time.Second, 10*time.Minute)
	if err != nil {
		problems = append(problems, fmt.Errorf("WORKER_RECONCILE_INTERVAL: %w", err))
	}
	operationTimeout, err := boundedDuration(getenv("WORKER_OPERATION_TIMEOUT"), defaultOperationTimeout, time.Second, 30*time.Minute)
	if err != nil {
		problems = append(problems, fmt.Errorf("WORKER_OPERATION_TIMEOUT: %w", err))
	}
	retryInitialDelay, err := boundedDuration(getenv("WORKER_RETRY_INITIAL_DELAY"), defaultRetryInitialDelay, 100*time.Millisecond, 5*time.Minute)
	if err != nil {
		problems = append(problems, fmt.Errorf("WORKER_RETRY_INITIAL_DELAY: %w", err))
	}
	retryMaxDelay, err := boundedDuration(getenv("WORKER_RETRY_MAX_DELAY"), defaultRetryMaxDelay, 100*time.Millisecond, time.Hour)
	if err != nil {
		problems = append(problems, fmt.Errorf("WORKER_RETRY_MAX_DELAY: %w", err))
	}
	if leaseDuration > 0 && leaseRenewInterval >= leaseDuration {
		problems = append(problems, errors.New("WORKER_LEASE_RENEW_INTERVAL must be shorter than WORKER_LEASE_DURATION"))
	}
	if retryInitialDelay > retryMaxDelay {
		problems = append(problems, errors.New("WORKER_RETRY_INITIAL_DELAY must not exceed WORKER_RETRY_MAX_DELAY"))
	}
	instanceSecretKeyring, err := secrets.ParseKeyringJSON(strings.TrimSpace(getenv("INSTANCE_SECRET_KEYS")))
	if err != nil {
		problems = append(problems, fmt.Errorf("INSTANCE_SECRET_KEYS: %w", err))
	}
	enabledProviders, err := parseEnabledProviders(getenv("WORKER_ENABLED_PROVIDERS"))
	if err != nil {
		problems = append(problems, fmt.Errorf("WORKER_ENABLED_PROVIDERS: %w", err))
	}
	dockerPublicHost := strings.TrimSpace(getenv("WORKER_DOCKER_PUBLIC_HOST"))
	if providerEnabled(enabledProviders, contracts.ProviderDocker) && dockerPublicHost == "" {
		problems = append(problems, errors.New("WORKER_DOCKER_PUBLIC_HOST is required when Docker is enabled"))
	}
	kubernetesTCPPortStart, err := boundedInt32(getenv("WORKER_KUBERNETES_TCP_PORT_START"), 0, 1024, 65520)
	if err != nil {
		problems = append(problems, fmt.Errorf("WORKER_KUBERNETES_TCP_PORT_START: %w", err))
	}
	if err := errors.Join(problems...); err != nil {
		return Config{}, err
	}

	return Config{
		WorkerID:               workerID,
		PlatformID:             platformID,
		DatabaseURL:            databaseURL,
		ExpectedDatabaseRole:   expectedRole,
		DatabaseMaxConnections: maxConnections,
		DatabaseConnectTimeout: connectTimeout,
		HealthAddress:          healthAddress,
		ReadinessTimeout:       readinessTimeout,
		ShutdownTimeout:        shutdownTimeout,
		ClaimBatchSize:         claimBatchSize,
		JobConcurrency:         jobConcurrency,
		LeaseDuration:          leaseDuration,
		LeaseRenewInterval:     leaseRenewInterval,
		PollInterval:           pollInterval,
		ReconcileInterval:      reconcileInterval,
		OperationTimeout:       operationTimeout,
		RetryInitialDelay:      retryInitialDelay,
		RetryMaxDelay:          retryMaxDelay,
		InstanceSecretKeyring:  instanceSecretKeyring,
		EnabledProviders:       enabledProviders,
		DockerEndpoint:         valueOrDefault(getenv("WORKER_DOCKER_ENDPOINT"), defaultDockerEndpoint),
		DockerAPIVersion:       valueOrDefault(getenv("WORKER_DOCKER_API_VERSION"), defaultDockerAPIVersion),
		DockerPublicHost:       dockerPublicHost,
		KubernetesNamespace:    valueOrDefault(getenv("WORKER_KUBERNETES_NAMESPACE"), defaultKubernetesNamespace),
		KubernetesHTTPDomain:   strings.TrimSpace(getenv("WORKER_KUBERNETES_HTTP_DOMAIN")),
		KubernetesIngressClass: strings.TrimSpace(getenv("WORKER_KUBERNETES_INGRESS_CLASS")),
		KubernetesTLSSecret:    strings.TrimSpace(getenv("WORKER_KUBERNETES_TLS_SECRET")),
		KubernetesTCPPortStart: kubernetesTCPPortStart,
		KubernetesLBClass:      strings.TrimSpace(getenv("WORKER_KUBERNETES_LOAD_BALANCER_CLASS")),
	}, nil
}

func parseEnabledProviders(raw string) ([]contracts.InstanceProvider, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, errors.New("must list at least one of docker or kubernetes")
	}
	seen := make(map[contracts.InstanceProvider]struct{})
	providers := make([]contracts.InstanceProvider, 0, 2)
	for _, item := range strings.Split(raw, ",") {
		provider := contracts.InstanceProvider(strings.TrimSpace(item))
		if err := provider.Validate(); err != nil {
			return nil, err
		}
		if _, duplicate := seen[provider]; duplicate {
			return nil, fmt.Errorf("provider %q is listed more than once", provider)
		}
		seen[provider] = struct{}{}
		providers = append(providers, provider)
	}
	return providers, nil
}

func providerEnabled(providers []contracts.InstanceProvider, target contracts.InstanceProvider) bool {
	for _, provider := range providers {
		if provider == target {
			return true
		}
	}
	return false
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

func boundedInt(raw string, fallback, minimum, maximum int) (int, error) {
	if strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value < minimum || value > maximum {
		return 0, fmt.Errorf("must be an integer from %d to %d", minimum, maximum)
	}
	return value, nil
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
