package config

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Host                  string
	Port                  string
	DatabaseURL           string
	JWTSecret             string
	InstanceLeaseDuration time.Duration
	InstanceRenewalWindow time.Duration
}

func Load() *Config {
	loadDotEnv(".env")

	return &Config{
		Host:                  getEnv("HOST", "0.0.0.0"),
		Port:                  getEnv("PORT", "8080"),
		DatabaseURL:           getEnv("DATABASE_URL", ""),
		JWTSecret:             getEnv("JWT_SECRET", "dev-secret-change-in-production"),
		InstanceLeaseDuration: getEnvMinutes("INSTANCE_LEASE_DURATION_MINUTES", 30),
		InstanceRenewalWindow: getEnvMinutes("INSTANCE_RENEWAL_WINDOW_MINUTES", 10),
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
