#!/usr/bin/env bash
set -euo pipefail

postgres_image="${TEST_POSTGRES_IMAGE:-postgres:17.6-alpine}"
minio_image="${TEST_MINIO_IMAGE:-minio/minio:RELEASE.2025-07-23T15-54-02Z}"
run_id="$(date +%s)-$$"
network="sauryctf-backup-recovery-${run_id}"
source_postgres="sauryctf-backup-source-postgres-${run_id}"
source_minio="sauryctf-backup-source-minio-${run_id}"
backup_minio="sauryctf-backup-repository-${run_id}"
restore_postgres="sauryctf-backup-restore-postgres-${run_id}"
restore_minio="sauryctf-backup-restore-minio-${run_id}"
backup_bucket="sauryctf-${run_id}"
scratch_dir="$(mktemp -d "${TMPDIR:-/tmp}/sauryctf-backup-recovery.XXXXXX")"
database_dump="${scratch_dir}/postgres.dump"
source_password='sauryctf-backup-source'
restore_password='sauryctf-backup-restore'
object_access_key='sauryctf'
object_secret_key='sauryctf-backup-secret'
backup_access_key='sauryctfbackup'
backup_secret_key='sauryctf-backup-repository-secret'

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  docker container stop \
    "${source_postgres}" "${source_minio}" "${backup_minio}" \
    "${restore_postgres}" "${restore_minio}" >/dev/null 2>&1 || true
  docker container rm \
    "${source_postgres}" "${source_minio}" "${backup_minio}" \
    "${restore_postgres}" "${restore_minio}" >/dev/null 2>&1 || true
  docker network rm "${network}" >/dev/null 2>&1 || true
  rm -rf "${scratch_dir}"
  exit "${status}"
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

start_postgres() {
  local container="$1"
  local password="$2"
  docker run --detach --name "${container}" --network "${network}" \
    --publish 127.0.0.1::5432 \
    --volume "${scratch_dir}:/backup" \
    --health-cmd='pg_isready -U postgres -d postgres' \
    --health-interval=1s --health-timeout=3s --health-retries=90 \
    --env POSTGRES_PASSWORD="${password}" \
    "${postgres_image}" >/dev/null
  wait_healthy "${container}"
}

start_minio() {
  local container="$1"
  local access_key="$2"
  local secret_key="$3"
  local publish_port="$4"
  if [[ "${publish_port}" == "true" ]]; then
    docker run --detach --name "${container}" --network "${network}" \
      --publish 127.0.0.1::9000 \
      --health-cmd='mc ready local' \
      --health-interval=1s --health-timeout=3s --health-retries=90 \
      --env MINIO_ROOT_USER="${access_key}" \
      --env MINIO_ROOT_PASSWORD="${secret_key}" \
      "${minio_image}" server /data >/dev/null
  else
    docker run --detach --name "${container}" --network "${network}" \
      --health-cmd='mc ready local' \
      --health-interval=1s --health-timeout=3s --health-retries=90 \
      --env MINIO_ROOT_USER="${access_key}" \
      --env MINIO_ROOT_PASSWORD="${secret_key}" \
      "${minio_image}" server /data >/dev/null
  fi
  wait_healthy "${container}"
}

docker info >/dev/null
docker network create "${network}" >/dev/null

start_postgres "${source_postgres}" "${source_password}"
source_postgres_port="$(published_port "${source_postgres}" 5432)"
source_database_url="postgresql://postgres:${source_password}@127.0.0.1:${source_postgres_port}/postgres"

start_minio "${source_minio}" "${object_access_key}" "${object_secret_key}" true
source_minio_port="$(published_port "${source_minio}" 9000)"
source_s3_endpoint="http://127.0.0.1:${source_minio_port}"
docker exec "${source_minio}" mc alias set source http://127.0.0.1:9000 \
  "${object_access_key}" "${object_secret_key}" >/dev/null
docker exec "${source_minio}" mc mb --ignore-existing source/sauryctf >/dev/null

start_minio "${backup_minio}" "${backup_access_key}" "${backup_secret_key}" false
docker exec "${backup_minio}" mc alias set backup http://127.0.0.1:9000 \
  "${backup_access_key}" "${backup_secret_key}" >/dev/null
docker exec "${backup_minio}" mc alias set source "http://${source_minio}:9000" \
  "${object_access_key}" "${object_secret_key}" >/dev/null
docker exec "${backup_minio}" mc mb --ignore-existing "backup/${backup_bucket}" >/dev/null
docker exec "${backup_minio}" mc version enable "backup/${backup_bucket}" >/dev/null

DATABASE_URL="${source_database_url}" pnpm db:migrate
BACKUP_RECOVERY_PHASE=seed \
TEST_DATABASE_URL="${source_database_url}" \
TEST_S3_ENDPOINT="${source_s3_endpoint}" \
TEST_S3_REGION='us-east-1' \
TEST_S3_BUCKET='sauryctf' \
TEST_S3_ACCESS_KEY_ID="${object_access_key}" \
TEST_S3_SECRET_ACCESS_KEY="${object_secret_key}" \
  pnpm --filter sauryctf-web exec vitest run \
    server/infrastructure/recovery/backup-restore.test.ts \
    --reporter=verbose

marker_epoch="$(docker exec "${source_postgres}" psql -U postgres -d postgres -tAc \
  "SELECT extract(epoch FROM occurred_at)::bigint FROM domain_outbox WHERE dedupe_key = 'backup-recovery-authoritative-cutoff'")"
if [[ ! "${marker_epoch}" =~ ^[0-9]+$ ]]; then
  echo "Backup recovery marker was not created" >&2
  exit 1
fi

backup_started_epoch="$(date +%s)"
docker exec "${source_postgres}" pg_dump -U postgres -d postgres \
  --format=custom --no-owner --no-privileges --file=/backup/postgres.dump
docker exec "${backup_minio}" mc mirror --overwrite --preserve \
  source/sauryctf "backup/${backup_bucket}"
backup_completed_epoch="$(date +%s)"

if [[ ! -s "${database_dump}" ]]; then
  echo "PostgreSQL backup artifact is empty" >&2
  exit 1
fi
backup_object_count="$(docker exec "${backup_minio}" mc ls --recursive --json \
  "backup/${backup_bucket}" | wc -l | tr -d ' ')"
if [[ ! "${backup_object_count}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Object-storage backup contains no objects" >&2
  exit 1
fi

docker container stop "${source_postgres}" "${source_minio}" >/dev/null
outage_epoch="$(date +%s)"

start_postgres "${restore_postgres}" "${restore_password}"
restore_postgres_port="$(published_port "${restore_postgres}" 5432)"
restore_database_url="postgresql://postgres:${restore_password}@127.0.0.1:${restore_postgres_port}/postgres"

start_minio "${restore_minio}" "${object_access_key}" "${object_secret_key}" true
restore_minio_port="$(published_port "${restore_minio}" 9000)"
restore_s3_endpoint="http://127.0.0.1:${restore_minio_port}"
docker exec "${restore_minio}" mc alias set restore http://127.0.0.1:9000 \
  "${object_access_key}" "${object_secret_key}" >/dev/null
docker exec "${restore_minio}" mc mb --ignore-existing restore/sauryctf >/dev/null

docker exec "${restore_postgres}" pg_restore -U postgres -d postgres \
  --no-owner --no-privileges --exit-on-error /backup/postgres.dump
docker exec "${backup_minio}" mc alias set restore "http://${restore_minio}:9000" \
  "${object_access_key}" "${object_secret_key}" >/dev/null
docker exec "${backup_minio}" mc mirror --overwrite --preserve \
  "backup/${backup_bucket}" restore/sauryctf

BACKUP_RECOVERY_PHASE=restore \
TEST_DATABASE_URL="${restore_database_url}" \
TEST_S3_ENDPOINT="${restore_s3_endpoint}" \
TEST_S3_REGION='us-east-1' \
TEST_S3_BUCKET='sauryctf' \
TEST_S3_ACCESS_KEY_ID="${object_access_key}" \
TEST_S3_SECRET_ACCESS_KEY="${object_secret_key}" \
  pnpm --filter sauryctf-web exec vitest run \
    server/infrastructure/recovery/backup-restore.test.ts \
    --reporter=verbose

recovery_completed_epoch="$(date +%s)"
rpo_seconds=$((outage_epoch - marker_epoch))
rto_seconds=$((recovery_completed_epoch - outage_epoch))
backup_seconds=$((backup_completed_epoch - backup_started_epoch))
if (( rpo_seconds > 300 )); then
  echo "RPO objective missed: ${rpo_seconds}s exceeds 300s" >&2
  exit 1
fi
if (( rto_seconds > 1800 )); then
  echo "RTO objective missed: ${rto_seconds}s exceeds 1800s" >&2
  exit 1
fi

dump_sha256="$(shasum -a 256 "${database_dump}" | awk '{print $1}')"
printf 'BACKUP_RECOVERY {"status":"passed","rpo_seconds":%s,"rto_seconds":%s,"backup_seconds":%s,"database_dump_sha256":"%s","object_count":%s,"scoreboard_rebuilt":true}\n' \
  "${rpo_seconds}" "${rto_seconds}" "${backup_seconds}" "${dump_sha256}" "${backup_object_count}"
