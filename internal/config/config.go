package config

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Host                      string
	Port                      string
	DatabaseURL               string
	JWTSecret                 string
	InstanceLeaseDuration     time.Duration
	InstanceExtensionDuration time.Duration
	InstanceRenewalWindow     time.Duration
	InstanceTeamActiveLimit   int
	InstanceCleanupInterval   time.Duration
	InstanceDockerEnabled     bool
	InstanceDockerHost        string
}

func Load() *Config {
	loadDotEnv(".env")

	return &Config{
		Host:                      getEnv("HOST", "0.0.0.0"),
		Port:                      getEnv("PORT", "8080"),
		DatabaseURL:               getEnv("DATABASE_URL", ""),
		JWTSecret:                 getEnv("JWT_SECRET", "dev-secret-change-in-production"),
		InstanceLeaseDuration:     getEnvMinutes("INSTANCE_LEASE_DURATION_MINUTES", 30),
		InstanceExtensionDuration: getEnvMinutes("INSTANCE_EXTENSION_DURATION_MINUTES", 30),
		InstanceRenewalWindow:     getEnvMinutes("INSTANCE_RENEWAL_WINDOW_MINUTES", 10),
		InstanceTeamActiveLimit:   getEnvInt("INSTANCE_TEAM_ACTIVE_LIMIT", 3),
		InstanceCleanupInterval:   getEnvSeconds("INSTANCE_CLEANUP_INTERVAL_SECONDS", 60),
		InstanceDockerEnabled:     getEnvBool("INSTANCE_DOCKER_PROVIDER_ENABLED", false),
		InstanceDockerHost:        getEnv("INSTANCE_DOCKER_HOST", "127.0.0.1"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvMinutes(key string, fallback int) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return time.Duration(fallback) * time.Minute
	}

	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return time.Duration(fallback) * time.Minute
	}

	return time.Duration(value) * time.Minute
}

func getEnvInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}

	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}

	return value
}

func getEnvBool(key string, fallback bool) bool {
	raw := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if raw == "" {
		return fallback
	}

	switch raw {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func getEnvSeconds(key string, fallback int) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return time.Duration(fallback) * time.Second
	}

	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return time.Duration(fallback) * time.Second
	}

	return time.Duration(value) * time.Second
}

// loadDotEnv reads a .env file and sets environment variables (without overriding existing ones).
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return // no .env file, skip
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key := strings.TrimSpace(k)
		val := strings.TrimSpace(v)
		// strip surrounding quotes
		if len(val) >= 2 && (val[0] == '"' && val[len(val)-1] == '"' || val[0] == '\'' && val[len(val)-1] == '\'') {
			val = val[1 : len(val)-1]
		}
		if os.Getenv(key) == "" {
			os.Setenv(key, val)
		}
	}
}
