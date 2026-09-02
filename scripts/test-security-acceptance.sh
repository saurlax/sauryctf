#!/usr/bin/env bash
set -euo pipefail

postgres_image="${TEST_POSTGRES_IMAGE:-postgres:17.6-alpine}"
run_id="$(date +%s)-$$"
postgres_container="sauryctf-security-postgres-${run_id}"

cleanup() {
  docker container stop "${postgres_container}" >/dev/null 2>&1 || true
  docker container rm "${postgres_container}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker info >/dev/null
docker run --detach --name "${postgres_container}" \
  --publish 127.0.0.1::5432 \
  --health-cmd='pg_isready -U postgres -d postgres' \
  --health-interval=1s --health-timeout=3s --health-retries=60 \
  --env POSTGRES_PASSWORD=sauryctf-security \
  "${postgres_image}" >/dev/null

for _ in $(seq 1 90); do
  if [[ "$(docker inspect --format '{{.State.Health.Status}}' "${postgres_container}")" == "healthy" ]]; then
    break
  fi
  sleep 1
done
if [[ "$(docker inspect --format '{{.State.Health.Status}}' "${postgres_container}")" != "healthy" ]]; then
  docker logs "${postgres_container}"
  exit 1
fi
postgres_binding="$(docker port "${postgres_container}" 5432/tcp)"
postgres_port="${postgres_binding##*:}"
database_url="postgresql://postgres:sauryctf-security@127.0.0.1:${postgres_port}/postgres"

# Authentication, global-role authorization, CSRF, Turnstile, upload and ZIP
# hardening, Flag redaction, and the restricted Worker database role.
TEST_DATABASE_ADMIN_URL="${database_url}" \
  pnpm --filter sauryctf-web exec vitest run \
    server/db/migrate.test.ts \
    server/domains/identity/bootstrap.test.ts \
    server/domains/identity/capabilities.test.ts \
    server/domains/identity/human-verification.test.ts \
    server/domains/identity/service.test.ts \
    server/domains/identity/session.test.ts \
    server/infrastructure/auth/identity-e2e.test.ts \
    server/infrastructure/auth/identity-http.test.ts \
    server/infrastructure/auth/identity-mail-token-protector.test.ts \
    server/infrastructure/auth/protected-session.test.ts \
    server/infrastructure/auth/turnstile.test.ts \
    server/infrastructure/security/rate-limit.test.ts \
    server/infrastructure/security/postgres-rate-limit-store.test.ts \
    server/infrastructure/security/request-security.test.ts \
    server/infrastructure/security/submission-answer-protector.test.ts \
    server/domains/content/service.test.ts \
    server/domains/content/download-service.test.ts \
    server/infrastructure/content/content-http.test.ts \
    server/infrastructure/content/blob-route-security.test.ts \
    server/infrastructure/content/content-download-repository.test.ts \
    server/domains/contest-packages/service.test.ts \
    server/infrastructure/content/contest-package-archive.test.ts \
    server/infrastructure/db/contest-package-repository.test.ts \
    server/infrastructure/db/worker-role.test.ts \
    server/domains/challenges/flag-verifier.test.ts \
    server/domains/challenges/player-contest-challenge-service.test.ts \
    server/infrastructure/challenges/contest-challenge-http.test.ts \
    server/domains/submissions/service.test.ts \
    server/infrastructure/submissions/submission-http.test.ts \
    server/infrastructure/instances/instance-secret-envelope.test.ts \
    server/infrastructure/telemetry/logging.test.ts

# Worker-side payload validation, RBAC readiness, secret handling and log
# redaction provide the second half of the Flag and least-privilege boundary.
TEST_DATABASE_ADMIN_URL="${database_url}" \
  go test \
    ./apps/worker/internal/contracts \
    ./apps/worker/internal/database \
    ./apps/worker/internal/jobs \
    ./apps/worker/internal/providers/... \
    ./apps/worker/internal/reconcile \
    ./apps/worker/internal/secrets \
    ./apps/worker/internal/telemetry \
    -count=1
