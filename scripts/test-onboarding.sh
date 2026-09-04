#!/usr/bin/env bash
set -euo pipefail

postgres_image="${TEST_POSTGRES_IMAGE:-postgres:17.6-alpine}"
mailpit_image="${TEST_MAILPIT_IMAGE:-axllent/mailpit:v1.27.8}"
run_id="$(date +%s)-$$"
postgres_container="sauryctf-onboarding-postgres-${run_id}"
mailpit_container="sauryctf-onboarding-mailpit-${run_id}"
scratch_dir="$(mktemp -d "${TMPDIR:-/tmp}/sauryctf-onboarding.XXXXXX")"
control_plane_log="${scratch_dir}/control-plane.log"
worker_log="${scratch_dir}/worker.log"
blob_dir="${scratch_dir}/blob"
control_plane_pid=""
worker_pid=""
postgres_password='sauryctf-onboarding-postgres'
worker_password='sauryctf-onboarding-worker'

cleanup() {
  if [[ -n "${control_plane_pid}" ]] && kill -0 "${control_plane_pid}" >/dev/null 2>&1; then
    kill -TERM "${control_plane_pid}" >/dev/null 2>&1 || true
    wait "${control_plane_pid}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${worker_pid}" ]] && kill -0 "${worker_pid}" >/dev/null 2>&1; then
    kill -TERM "${worker_pid}" >/dev/null 2>&1 || true
    wait "${worker_pid}" >/dev/null 2>&1 || true
  fi
  docker container stop "${postgres_container}" "${mailpit_container}" >/dev/null 2>&1 || true
  docker container rm "${postgres_container}" "${mailpit_container}" >/dev/null 2>&1 || true
  rm -rf "${scratch_dir}"
}
trap cleanup EXIT INT TERM

wait_healthy() {
  local container="$1"
  for _ in $(seq 1 120); do
    if [[ "$(docker inspect --format '{{.State.Health.Status}}' "${container}")" == "healthy" ]]; then
      return 0
    fi
    sleep 1
  done
  docker logs "${container}"
  return 1
}

published_port() {
  local container="$1"
  local port="$2"
  local binding
  binding="$(docker port "${container}" "${port}/tcp")"
  echo "${binding##*:}"
}

free_port() {
  node -e "const server=require('node:net').createServer();server.listen(0,'127.0.0.1',()=>{process.stdout.write(String(server.address().port));server.close()})"
}

wait_http() {
  local process_id="$1"
  local url="$2"
  local log_file="$3"
  for _ in $(seq 1 120); do
    if ! kill -0 "${process_id}" >/dev/null 2>&1; then
      sed -n '1,240p' "${log_file}"
      return 1
    fi
    if curl --fail --silent "${url}" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  sed -n '1,240p' "${log_file}"
  return 1
}

docker info >/dev/null

docker run --detach --name "${postgres_container}" \
  --publish 127.0.0.1::5432 \
  --health-cmd='pg_isready -U postgres -d sauryctf' \
  --health-interval=1s --health-timeout=3s --health-retries=90 \
  --env POSTGRES_DB=sauryctf \
  --env POSTGRES_USER=postgres \
  --env POSTGRES_PASSWORD="${postgres_password}" \
  "${postgres_image}" >/dev/null
wait_healthy "${postgres_container}"
postgres_port="$(published_port "${postgres_container}" 5432)"
database_url="postgresql://postgres:${postgres_password}@127.0.0.1:${postgres_port}/sauryctf"
database_admin_url="postgresql://postgres:${postgres_password}@127.0.0.1:${postgres_port}/postgres"

docker run --detach --name "${mailpit_container}" \
  --publish 127.0.0.1::1025 \
  --publish 127.0.0.1::8025 \
  --health-cmd='/mailpit readyz' \
  --health-interval=1s --health-timeout=3s --health-retries=90 \
  "${mailpit_image}" >/dev/null
wait_healthy "${mailpit_container}"
smtp_port="$(published_port "${mailpit_container}" 1025)"

DATABASE_URL="${database_url}" pnpm db:migrate
docker exec -i "${postgres_container}" psql -U postgres -d sauryctf -v ON_ERROR_STOP=1 \
  < deploy/postgres/worker-role.sql >/dev/null
docker exec "${postgres_container}" psql -U postgres -d sauryctf -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE sauryctf_worker_runtime LOGIN PASSWORD '${worker_password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT sauryctf_worker TO sauryctf_worker_runtime;" \
  >/dev/null

pnpm --filter sauryctf-web build

control_plane_port="$(free_port)"
DATABASE_URL="${database_url}" \
NUXT_PUBLIC_SITE_URL="http://127.0.0.1:${control_plane_port}" \
NUXT_SESSION_PASSWORD='onboarding-session-secret-at-least-32-characters' \
SUBMISSION_ANSWER_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' \
INSTANCE_SECRET_ACTIVE_KEY_ID='onboarding-worker-key-v1' \
INSTANCE_SECRET_KEYS='{"onboarding-worker-key-v1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"}' \
NUXTHUB_BLOB_DIR="${blob_dir}" \
CONTROL_PLANE_REPLICA_COUNT='1' \
MAIL_SMTP_HOST='127.0.0.1' \
MAIL_SMTP_PORT="${smtp_port}" \
MAIL_FROM='SauryCTF <noreply@example.test>' \
OTEL_SDK_DISABLED='true' \
NITRO_HOST='127.0.0.1' \
NITRO_PORT="${control_plane_port}" \
  node apps/web/.output/server/index.mjs >>"${control_plane_log}" 2>&1 &
control_plane_pid=$!
wait_http "${control_plane_pid}" "http://127.0.0.1:${control_plane_port}/api/health/live" "${control_plane_log}"
wait_http "${control_plane_pid}" "http://127.0.0.1:${control_plane_port}/api/health/ready" "${control_plane_log}"

worker_port="$(free_port)"
docker_host="${TEST_DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}"
WORKER_ID="onboarding-worker-${run_id}" \
WORKER_PLATFORM_ID='sauryctf' \
WORKER_DATABASE_URL="postgresql://sauryctf_worker_runtime:${worker_password}@127.0.0.1:${postgres_port}/sauryctf" \
WORKER_DATABASE_EXPECTED_ROLE='sauryctf_worker' \
WORKER_HEALTH_ADDRESS="127.0.0.1:${worker_port}" \
WORKER_ENABLED_PROVIDERS='docker' \
WORKER_DOCKER_ENDPOINT="${docker_host}" \
WORKER_DOCKER_API_VERSION='v1.47' \
WORKER_DOCKER_PUBLIC_HOST='127.0.0.1' \
INSTANCE_SECRET_KEYS='{"onboarding-worker-key-v1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"}' \
OTEL_SDK_DISABLED='true' \
  go run ./apps/worker/cmd/worker >>"${worker_log}" 2>&1 &
worker_pid=$!
wait_http "${worker_pid}" "http://127.0.0.1:${worker_port}/health/live" "${worker_log}"
wait_http "${worker_pid}" "http://127.0.0.1:${worker_port}/health/ready" "${worker_log}"

worker_business_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "http://127.0.0.1:${worker_port}/api/auth/login")"
if [[ "${worker_business_status}" != '404' ]]; then
  echo "Worker exposed an unexpected business route with status ${worker_business_status}" >&2
  exit 1
fi

TEST_DATABASE_ADMIN_URL="${database_admin_url}" bash ./scripts/test-jeopardy-smoke.sh

admin_count="$(docker exec "${postgres_container}" psql -U postgres -d sauryctf \
  -tAc "SELECT count(*) FROM users WHERE username_normalized = 'admin'")"
if [[ "${admin_count}" != '1' ]]; then
  echo "Fresh control-plane database did not bootstrap exactly one administrator" >&2
  exit 1
fi

echo 'DOCS_ONBOARDING {"status":"passed","dependencies":"fresh-postgresql-mailpit-local-blob","control_plane":"ready","worker":"ready-private","jeopardy_smoke":"passed"}'
