#!/usr/bin/env bash
set -euo pipefail

database_admin_url="${TEST_DATABASE_ADMIN_URL:-postgresql://sauryctf:sauryctf-dev@127.0.0.1:15432/postgres}"

TEST_DATABASE_ADMIN_URL="${database_admin_url}" \
  pnpm --filter sauryctf-web exec vitest run \
    server/infrastructure/smoke/jeopardy-flow.test.ts \
    --reporter=verbose

echo 'JEOPARDY_SMOKE {"status":"passed","database":"isolated","flow":"bootstrap-registration-team-contest-submission-scoreboard-practice-writeup"}'
