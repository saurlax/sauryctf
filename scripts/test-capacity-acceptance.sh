#!/usr/bin/env bash
set -euo pipefail

postgres_image="${TEST_POSTGRES_IMAGE:-postgres:17.6-alpine}"
run_id="$(date +%s)-$$"
postgres_container="sauryctf-capacity-postgres-${run_id}"
scratch_dir="$(mktemp -d "${TMPDIR:-/tmp}/sauryctf-capacity.XXXXXX")"
report_path="${scratch_dir}/capacity-report.json"

cleanup() {
  docker container stop "${postgres_container}" >/dev/null 2>&1 || true
  docker container rm "${postgres_container}" >/dev/null 2>&1 || true
  rm -rf "${scratch_dir}"
}
trap cleanup EXIT INT TERM

docker info >/dev/null
docker run --detach --name "${postgres_container}" \
  --publish 127.0.0.1::5432 \
  --health-cmd='pg_isready -U postgres -d postgres' \
  --health-interval=1s --health-timeout=3s --health-retries=90 \
  --env POSTGRES_PASSWORD=sauryctf-capacity \
  --shm-size=512m \
  "${postgres_image}" \
  -c max_connections=200 \
  -c shared_buffers=256MB >/dev/null

for _ in $(seq 1 120); do
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
database_url="postgresql://postgres:sauryctf-capacity@127.0.0.1:${postgres_port}/postgres"

TEST_DATABASE_ADMIN_URL="${database_url}" \
CAPACITY_REPORT_PATH="${report_path}" \
  pnpm --filter sauryctf-web exec vitest run \
    server/infrastructure/performance/capacity.test.ts \
    server/infrastructure/performance/rate-limit-capacity.test.ts \
    --reporter=verbose

echo "Capacity acceptance report:"
sed -n '1,240p' "${report_path}"
