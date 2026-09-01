# SauryCTF — AI Agent Instructions

SauryCTF is being rebuilt as a Jeopardy-first CTF platform with a Nuxt/Nitro
control plane and a private Go instance worker.

## Authoritative architecture

- `apps/web/` is the Nuxt 4/Nitro application and the only public business
  entry point. It owns UI, API, authentication, authorization, transactions,
  cache coordination, SSE, outbox processing, and scheduled control-plane jobs.
- `apps/worker/` is an independent Go module. It may only consume
  `instance_jobs`, operate approved Docker/Kubernetes providers, reconcile
  managed resources, and write instance observations.
- `legacy/go-monolith/` is temporary migration reference. It is not an active
  workspace module, must be tested with `GOWORK=off`, and must never be imported
  by either active application.
- PostgreSQL is authoritative. Redis contains rebuildable cache, rate-limit,
  short-lock, and realtime state only. S3-compatible storage is authoritative
  for content objects.
- Challenge traffic goes directly through Gateway/Ingress/Service. It does not
  pass through Nuxt or the worker.
- The first release implements Jeopardy only. Do not add AWD, VPN, terminal
  gateway, Checker, mixed-mode, or generic code-execution production surfaces.

The active OpenSpec change is
`openspec/changes/rebuild-platform-with-nuxt-control-plane/`. The independent
`add-awd-competition` change is design-only and must not be implemented unless
the user explicitly requests it later.

## Repository layout

```text
apps/
  web/                    # public Nuxt/Nitro control plane
  worker/                 # private Go instance worker
legacy/
  go-monolith/            # temporary read-only migration reference
api/                      # generated public OpenAPI artifact
docs/                     # architecture and operations documentation
openspec/                 # specifications and implementation tasks
scripts/                  # repository checks and migration-era smoke helpers
```

Do not add application business source under root `cmd/`, `internal/`,
`frontend/`, `server/`, or `worker/` directories.

## Commands

| Action | Command |
| --- | --- |
| Start Nuxt control plane | `pnpm dev` or `pnpm dev:web` |
| Start development dependencies | `pnpm dev:dependencies` |
| Stop development dependencies | `pnpm dev:dependencies:down` |
| Run PostgreSQL migrations | `pnpm db:migrate` |
| Generate OpenAPI and TS types | `pnpm generate:api` |
| Check architecture boundaries | `pnpm check:boundaries` |
| Check Jeopardy-only scope | `pnpm check:jeopardy-scope` |
| Check pinned toolchain | `pnpm check:toolchain` |
| Test shared contracts | `pnpm test:contracts` |
| Test database migrations | `pnpm test:db` |
| Type-check Nuxt | `pnpm typecheck` |
| Build Nuxt/Nitro | `pnpm build` |
| Test active Go worker | `pnpm test:worker` |
| Test isolated legacy monolith | `pnpm test:legacy` |

`pnpm dev:legacy` and the `smoke:local*` scripts exist only to inspect or
regression-test the isolated legacy implementation during migration. They are
not the target production topology.

## Nuxt control plane conventions

- Public API handlers live in `apps/web/server/api` and remain thin protocol
  adapters. They must not access Drizzle tables directly.
- Authorization and transaction rules live in `apps/web/server/domains`.
- Database, cache, events, mail, storage, and telemetry adapters live in
  `apps/web/server/infrastructure` and must not depend on pages or API handlers.
- Runtime Zod contracts live in `apps/web/shared/contracts`; generated public
  types live in `apps/web/app/types/control-plane-api.d.ts`.
- Database migrations live in `apps/web/db/migrations` and PostgreSQL semantics
  are authoritative.
- Use `nuxt-auth-utils` sealed cookies for browser auth. Do not add a sessions
  table or browser JWT role snapshot.
- Prefer Nuxt UI components and keep user-facing copy formal. Low-frequency or
  destructive actions should use `UModal` and clear modal drafts on all close
  paths.
- API errors use `e.data?.message || e.message` in toasts.
- After every Web code change run `cd apps/web && pnpm nuxt typecheck`.
- When runtime contracts change, run the root `pnpm generate:api`; never update
  only the OpenAPI file or only the generated TypeScript type.

## Go worker conventions

- `apps/worker/go.mod` is the only active Go module in `go.work`.
- The worker must not implement user, auth, team, contest, challenge, Flag,
  submission, scoring, scoreboard, or administrator HTTP business APIs.
- The worker must not import `legacy/go-monolith` or its module packages.
- Instance operations are limited to `ensure`, `inspect`, `destroy`, and
  `reconcile` until a later approved OpenSpec change expands the protocol.
- Provider operations must be idempotent, use deterministic resource names and
  complete ownership labels, and must not use shell command concatenation.
- Docker uses the Engine API; Kubernetes uses `client-go`.

## Legacy isolation

The legacy module keeps its existing module path only so its internal imports
continue to compile while it is used as migration reference. Always invoke it
from `legacy/go-monolith` with `GOWORK=off`. Do not generate the active public
API into it and do not copy its Gin handlers, JWT sessions, GORM models, Docker
CLI provider, roles, or AWD category into either active application.

## Verification and editing

- Use `rg`/`rg --files` for searches and `apply_patch` for edits.
- Preserve unrelated dirty-worktree changes.
- A task checkbox may be completed only after its stated tests pass.
- Before marking monorepo or boundary work complete, run at least:
  `pnpm check:toolchain`, `pnpm check:boundaries`,
  `pnpm check:jeopardy-scope`, `pnpm generate:api`, `pnpm typecheck`,
  `pnpm test:contracts`, `pnpm build`, `pnpm test:worker`, and
  `pnpm test:legacy`.
