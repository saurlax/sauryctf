#!/usr/bin/env bash
set -euo pipefail

change_name='adopt-nuxthub-data-management'
started_epoch="$(date +%s)"
source_revision="$(git rev-parse --verify HEAD)"

run_gate() {
  local name="$1"
  shift
  printf '\nRELEASE_GATE_START %s\n' "${name}"
  "$@"
  printf 'RELEASE_GATE_PASS %s\n' "${name}"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Required release command is unavailable: %s\n' "$1" >&2
    exit 1
  fi
}

require_command docker
require_command go
require_command kubectl
require_command node
require_command openspec
require_command pnpm
require_command rg

verify_removed_cache_runtime() {
  local service_name='re''dis'
  local client_name='io''re''dis'
  if rg -n -i "${service_name}|${client_name}" \
    package.json apps/web/package.json apps/worker/go.mod apps/worker/go.sum \
    .env.example compose.dev.yml .github scripts \
    apps/web/app apps/web/server apps/web/shared apps/web/nuxt.config.ts \
    apps/web/.output --glob '!**/*.map'; then
    echo 'Removed cache backend found in a direct dependency, runtime input, source, or publishable build artifact' >&2
    return 1
  fi
}

run_gate frozen_install pnpm install --frozen-lockfile
run_gate checks pnpm check
run_gate unit_tests pnpm test
run_gate fresh_onboarding bash ./scripts/test-onboarding.sh
run_gate security bash ./scripts/test-security-acceptance.sh
run_gate capacity bash ./scripts/test-capacity-acceptance.sh
run_gate fault_recovery bash ./scripts/test-fault-recovery.sh
run_gate backup_recovery_s3 env BACKUP_BLOB_DRIVER=s3 bash ./scripts/test-backup-recovery.sh
run_gate backup_recovery_fs env BACKUP_BLOB_DRIVER=fs bash ./scripts/test-backup-recovery.sh
run_gate instance_lifecycle bash ./scripts/test-instance-lifecycle.sh
run_gate applications_build pnpm build
run_gate removed_cache_runtime verify_removed_cache_runtime
run_gate openspec_strict openspec validate "${change_name}" --strict
run_gate diff_check git diff --check

if docker ps -a --format '{{.Names}}' \
  | rg '^sauryctf-(onboarding|security|capacity|fault|backup|lifecycle)-' >/dev/null; then
  echo 'Release acceptance left disposable containers behind' >&2
  docker ps -a --format '{{.Names}}' \
    | rg '^sauryctf-(onboarding|security|capacity|fault|backup|lifecycle)-' >&2
  exit 1
fi

completed_epoch="$(date +%s)"
duration_seconds="$((completed_epoch - started_epoch))"
printf '\nRELEASE_ACCEPTANCE {"status":"passed","change":"%s","source_revision":"%s","duration_seconds":%s,"jeopardy_only":true}\n' \
  "${change_name}" "${source_revision}" "${duration_seconds}"
