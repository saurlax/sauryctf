#!/usr/bin/env bash
set -euo pipefail

docker_host="${TEST_DOCKER_HOST:-unix:///var/run/docker.sock}"
k3s_image="${TEST_K3S_SERVER_IMAGE:-rancher/k3s:v1.34.1-k3s1}"
postgres_image="${TEST_POSTGRES_IMAGE:-postgres:17.6-alpine}"
run_id="$(date +%s)-$$"
k3s_container="sauryctf-lifecycle-k3s-${run_id}"
postgres_container="sauryctf-lifecycle-postgres-${run_id}"
scratch_dir="$(mktemp -d "${TMPDIR:-/tmp}/sauryctf-instance-lifecycle.XXXXXX")"
kubeconfig="${scratch_dir}/kubeconfig.yaml"

cleanup() {
  docker container stop "${k3s_container}" "${postgres_container}" >/dev/null 2>&1 || true
  docker container rm "${k3s_container}" "${postgres_container}" >/dev/null 2>&1 || true
  if [[ -f "${kubeconfig}" ]]; then
    unlink "${kubeconfig}"
  fi
  rmdir "${scratch_dir}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker info >/dev/null

docker run --detach --name "${postgres_container}" \
  --publish 127.0.0.1::5432 \
  --health-cmd='pg_isready -U postgres -d postgres' \
  --health-interval=1s --health-timeout=3s --health-retries=60 \
  --env POSTGRES_PASSWORD=sauryctf-lifecycle \
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
database_url="postgresql://postgres:sauryctf-lifecycle@127.0.0.1:${postgres_port}/postgres"

docker run --privileged --detach --name "${k3s_container}" \
  --publish 127.0.0.1::6443 \
  "${k3s_image}" server \
  --disable=traefik --disable=servicelb --disable=metrics-server \
  --snapshotter=native --tls-san=127.0.0.1 >/dev/null

for _ in $(seq 1 120); do
  if docker exec "${k3s_container}" kubectl get --raw=/readyz >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker exec "${k3s_container}" kubectl get --raw=/readyz >/dev/null 2>&1; then
  docker logs "${k3s_container}"
  exit 1
fi
k3s_binding="$(docker port "${k3s_container}" 6443/tcp)"
k3s_port="${k3s_binding##*:}"
docker cp "${k3s_container}:/etc/rancher/k3s/k3s.yaml" "${kubeconfig}" >/dev/null
kubectl config set-cluster default \
  --server="https://127.0.0.1:${k3s_port}" \
  --kubeconfig="${kubeconfig}" >/dev/null

TEST_DATABASE_ADMIN_URL="${database_url}" \
  pnpm --filter sauryctf-web exec vitest run server/infrastructure/db/instance-repository.test.ts

TEST_DATABASE_ADMIN_URL="${database_url}" \
  go test ./apps/worker/internal/jobs ./apps/worker/internal/reconcile -count=1

TEST_DOCKER_HOST="${docker_host}" \
  go test ./apps/worker/internal/providers/docker -run '^TestProviderAgainstDockerEngine$' -count=1 -v

TEST_K3S_KUBECONFIG="${kubeconfig}" \
  go test ./apps/worker/internal/providers/kubernetes -run '^TestProviderAgainstK3s$' -count=1 -v
