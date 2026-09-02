#!/usr/bin/env bash
set -euo pipefail

change_name='rebuild-platform-with-nuxt-control-plane'
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

run_gate frozen_install pnpm install --frozen-lockfile
run_gate toolchain pnpm check:toolchain
run_gate boundaries pnpm check:boundaries
run_gate jeopardy_scope pnpm check:jeopardy-scope

run_gate openapi_generation pnpm generate:api
run_gate openapi_clean git diff --exit-code -- \
  api/openapi.yaml apps/web/app/types/control-plane-api.d.ts

run_gate contracts pnpm test:contracts
run_gate fresh_onboarding pnpm test:onboarding
run_gate jeopardy_smoke pnpm test:smoke
run_gate security pnpm test:security
run_gate capacity pnpm test:capacity
run_gate fault_recovery pnpm test:faults
run_gate backup_recovery pnpm test:backup-recovery
run_gate instance_lifecycle pnpm test:instances:lifecycle

run_gate nuxt_typecheck pnpm typecheck
run_gate nuxt_build pnpm build
run_gate worker_tests pnpm test:worker
run_gate worker_build pnpm build:worker
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
