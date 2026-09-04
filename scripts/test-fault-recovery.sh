#!/usr/bin/env bash
set -euo pipefail

postgres_image="${TEST_POSTGRES_IMAGE:-postgres:17.6-alpine}"
minio_image="${TEST_MINIO_IMAGE:-minio/minio:RELEASE.2025-07-23T15-54-02Z}"
mailpit_image="${TEST_MAILPIT_IMAGE:-axllent/mailpit:v1.27.8}"
run_id="$(date +%s)-$$"
postgres_container="sauryctf-fault-postgres-${run_id}"
minio_container="sauryctf-fault-minio-${run_id}"
mailpit_container="sauryctf-fault-mailpit-${run_id}"
scratch_dir="$(mktemp -d "${TMPDIR:-/tmp}/sauryctf-fault-recovery.XXXXXX")"
control_plane_log="${scratch_dir}/control-plane.log"
control_plane_pid=""
control_database="sauryctf_control_plane_fault"

cleanup() {
  if [[ -n "${control_plane_pid}" ]] && kill -0 "${control_plane_pid}" >/dev/null 2>&1; then
    kill -TERM "${control_plane_pid}" >/dev/null 2>&1 || true
    wait "${control_plane_pid}" >/dev/null 2>&1 || true
  fi
  docker container stop \
    "${postgres_container}" "${minio_container}" "${mailpit_container}" \
    >/dev/null 2>&1 || true
  docker container rm \
    "${postgres_container}" "${minio_container}" "${mailpit_container}" \
    >/dev/null 2>&1 || true
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

wait_control_plane() {
  for _ in $(seq 1 120); do
    if ! kill -0 "${control_plane_pid}" >/dev/null 2>&1; then
      sed -n '1,240p' "${control_plane_log}"
      return 1
    fi
    if curl --fail --silent "http://127.0.0.1:${control_plane_port}/api/health/live" >/dev/null \
      && curl --fail --silent "http://127.0.0.1:${control_plane_port}/api/health/ready" >/dev/null \
      && curl --fail --silent "http://127.0.0.1:${control_plane_port}/api/platform/settings" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  sed -n '1,240p' "${control_plane_log}"
  return 1
}

start_control_plane() {
  DATABASE_URL="${control_database_url}" \
  NUXT_SESSION_PASSWORD='fault-recovery-session-secret-at-least-32-characters' \
  SUBMISSION_ANSWER_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' \
  INSTANCE_SECRET_ACTIVE_KEY_ID='fault-worker-key-v1' \
  INSTANCE_SECRET_KEYS='{"fault-worker-key-v1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"}' \
  S3_ENDPOINT="${s3_endpoint}" \
  S3_REGION='us-east-1' \
  S3_BUCKET='sauryctf' \
  S3_ACCESS_KEY_ID='sauryctf' \
  S3_SECRET_ACCESS_KEY='sauryctf-fault-secret' \
  S3_FORCE_PATH_STYLE='true' \
  MAIL_SMTP_HOST='127.0.0.1' \
  MAIL_SMTP_PORT="${smtp_port}" \
  MAIL_FROM='SauryCTF <noreply@example.test>' \
  NUXT_PUBLIC_SITE_URL="http://127.0.0.1:${control_plane_port}" \
  NITRO_HOST='127.0.0.1' \
  NITRO_PORT="${control_plane_port}" \
    node apps/web/.output/server/index.mjs >>"${control_plane_log}" 2>&1 &
  control_plane_pid=$!
  wait_control_plane
}

stop_control_plane() {
  kill -TERM "${control_plane_pid}"
  wait "${control_plane_pid}"
  control_plane_pid=""
}

docker info >/dev/null

docker run --detach --name "${postgres_container}" \
  --publish 127.0.0.1::5432 \
  --health-cmd='pg_isready -U postgres -d postgres' \
  --health-interval=1s --health-timeout=3s --health-retries=90 \
  --env POSTGRES_PASSWORD=sauryctf-fault \
  "${postgres_image}" >/dev/null
wait_healthy "${postgres_container}"
postgres_port="$(published_port "${postgres_container}" 5432)"
database_url="postgresql://postgres:sauryctf-fault@127.0.0.1:${postgres_port}/postgres"

docker run --detach --name "${minio_container}" \
  --publish 127.0.0.1::9000 \
  --health-cmd='mc ready local' \
  --health-interval=1s --health-timeout=3s --health-retries=90 \
  --env MINIO_ROOT_USER=sauryctf \
  --env MINIO_ROOT_PASSWORD=sauryctf-fault-secret \
  "${minio_image}" server /data >/dev/null
wait_healthy "${minio_container}"
minio_port="$(published_port "${minio_container}" 9000)"
s3_endpoint="http://127.0.0.1:${minio_port}"
docker exec "${minio_container}" mc alias set fault http://127.0.0.1:9000 \
  sauryctf sauryctf-fault-secret >/dev/null
docker exec "${minio_container}" mc mb --ignore-existing fault/sauryctf >/dev/null

docker run --detach --name "${mailpit_container}" \
  --publish 127.0.0.1::1025 \
  --publish 127.0.0.1::8025 \
  --health-cmd='/mailpit readyz' \
  --health-interval=1s --health-timeout=3s --health-retries=90 \
  "${mailpit_image}" >/dev/null
wait_healthy "${mailpit_container}"
smtp_port="$(published_port "${mailpit_container}" 1025)"
mailpit_port="$(published_port "${mailpit_container}" 8025)"
mailpit_api_url="http://127.0.0.1:${mailpit_port}"

TEST_DATABASE_ADMIN_URL="${database_url}" \
TEST_S3_ENDPOINT="${s3_endpoint}" \
TEST_S3_REGION='us-east-1' \
TEST_S3_BUCKET='sauryctf' \
TEST_S3_ACCESS_KEY_ID='sauryctf' \
TEST_S3_SECRET_ACCESS_KEY='sauryctf-fault-secret' \
TEST_SMTP_HOST='127.0.0.1' \
TEST_SMTP_PORT="${smtp_port}" \
TEST_MAILPIT_API_URL="${mailpit_api_url}" \
  pnpm --filter sauryctf-web exec vitest run \
    server/infrastructure/recovery/dependency-faults.test.ts \
    server/infrastructure/db/readiness.test.ts \
    server/infrastructure/storage/readiness.test.ts \
    --reporter=verbose

TEST_DATABASE_ADMIN_URL="${database_url}" \
  go test ./apps/worker/internal/jobs \
    -run '^TestRunnerOutageReleasesLeaseAndReplacementCompletes$' -count=1 -v

go test ./apps/worker/internal/providers/kubernetes \
  -run '^TestKubernetesAPIOutageIsRetryableAndRecovers$' -count=1 -v

docker exec "${postgres_container}" psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${control_database}" >/dev/null
control_database_url="postgresql://postgres:sauryctf-fault@127.0.0.1:${postgres_port}/${control_database}"
DATABASE_URL="${control_database_url}" pnpm db:migrate
pnpm --filter sauryctf-web build
control_plane_port="$(node -e "const server=require('node:net').createServer();server.listen(0,'127.0.0.1',()=>{process.stdout.write(String(server.address().port));server.close()})")"

start_control_plane
stop_control_plane
start_control_plane
admin_count="$(docker exec "${postgres_container}" psql -U postgres -d "${control_database}" \
  -tAc "SELECT count(*) FROM users WHERE username_normalized = 'admin'")"
if [[ "${admin_count}" != "1" ]]; then
  echo "Control-plane replacement changed the default administrator count: ${admin_count}" >&2
  exit 1
fi
stop_control_plane

echo 'FAULT_RECOVERY {"postgresql":"passed","blob_s3":"passed","blob_fs_permissions":"passed","smtp":"passed","worker":"passed","provider":"passed","control_plane_replica":"passed"}'
