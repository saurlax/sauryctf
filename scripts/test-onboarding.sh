#!/usr/bin/env bash
set -euo pipefail

postgres_image="${TEST_POSTGRES_IMAGE:-postgres:17.6-alpine}"
redis_image="${TEST_REDIS_IMAGE:-redis:7.4.5-alpine}"
minio_image="${TEST_MINIO_IMAGE:-minio/minio:RELEASE.2025-07-23T15-54-02Z}"
mailpit_image="${TEST_MAILPIT_IMAGE:-axllent/mailpit:v1.27.8}"
run_id="$(date +%s)-$$"
postgres_container="sauryctf-onboarding-postgres-${run_id}"
redis_container="sauryctf-onboarding-redis-${run_id}"
minio_container="sauryctf-onboarding-minio-${run_id}"
mailpit_container="sauryctf-onboarding-mailpit-${run_id}"
control_plane_log="$(mktemp "${TMPDIR:-/tmp}/sauryctf-onboarding-control.XXXXXX")"
worker_log="$(mktemp "${TMPDIR:-/tmp}/sauryctf-onboarding-worker.XXXXXX")"
control_plane_pid=""
worker_pid=""
postgres_password='sauryctf-onboarding-postgres'
object_access_key='sauryctf'
object_secret_key='sauryctf-onboarding-object-secret'
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
  docker container stop \
    "${postgres_container}" "${redis_container}" "${minio_container}" "${mailpit_container}" \
    >/dev/null 2>&1 || true
  docker container rm \
    "${postgres_container}" "${redis_container}" "${minio_container}" "${mailpit_container}" \
    >/dev/null 2>&1 || true
  unlink "${control_plane_log}" >/dev/null 2>&1 || true
  unlink "${worker_log}" >/dev/null 2>&1 || true
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

docker run --detach --name "${redis_container}" \
  --publish 127.0.0.1::6379 \
  --health-cmd='redis-cli ping' \
  --health-interval=1s --health-timeout=3s --health-retries=90 \
  "${redis_image}" redis-server --save '' --appendonly no >/dev/null
wait_healthy "${redis_container}"
redis_port="$(published_port "${redis_container}" 6379)"
redis_url="redis://127.0.0.1:${redis_port}/0"

docker run --detach --name "${minio_container}" \
  --publish 127.0.0.1::9000 \
  --health-cmd='mc ready local' \
  --health-interval=1s --health-timeout=3s --health-retries=90 \
  --env MINIO_ROOT_USER="${object_access_key}" \
  --env MINIO_ROOT_PASSWORD="${object_secret_key}" \
  "${minio_image}" server /data >/dev/null
wait_healthy "${minio_container}"
minio_port="$(published_port "${minio_container}" 9000)"
s3_endpoint="http://127.0.0.1:${minio_port}"
docker exec "${minio_container}" mc alias set onboarding http://127.0.0.1:9000 \
  "${object_access_key}" "${object_secret_key}" >/dev/null
docker exec "${minio_container}" mc mb --ignore-existing onboarding/sauryctf >/dev/null

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

pnpm build

control_plane_port="$(free_port)"
DATABASE_URL="${database_url}" \
REDIS_URL="${redis_url}" \
PUBLIC_ORIGIN="http://127.0.0.1:${control_plane_port}" \
NUXT_SESSION_PASSWORD='onboarding-session-secret-at-least-32-characters' \
SUBMISSION_ANSWER_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' \
INSTANCE_SECRET_ACTIVE_KEY_ID='onboarding-worker-key-v1' \
INSTANCE_SECRET_KEYS='{"onboarding-worker-key-v1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"}' \
S3_ENDPOINT="${s3_endpoint}" \
S3_REGION='us-east-1' \
S3_BUCKET='sauryctf' \
S3_ACCESS_KEY_ID="${object_access_key}" \
S3_SECRET_ACCESS_KEY="${object_secret_key}" \
S3_FORCE_PATH_STYLE='true' \
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

TEST_DATABASE_ADMIN_URL="${database_admin_url}" pnpm test:smoke

admin_count="$(docker exec "${postgres_container}" psql -U postgres -d sauryctf \
  -tAc "SELECT count(*) FROM users WHERE username_normalized = 'admin'")"
if [[ "${admin_count}" != '1' ]]; then
  echo "Fresh control-plane database did not bootstrap exactly one administrator" >&2
  exit 1
fi

echo 'DOCS_ONBOARDING {"status":"passed","dependencies":"fresh","control_plane":"ready","worker":"ready-private","jeopardy_smoke":"passed"}'
