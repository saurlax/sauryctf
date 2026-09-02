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
api/                      # generated public OpenAPI artifact
docs/                     # architecture and operations documentation
openspec/                 # specifications and implementation tasks
scripts/                  # repository checks and release acceptance helpers
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
| Run full release acceptance | `pnpm test:release` |
| Type-check Nuxt | `pnpm typecheck` |
| Build Nuxt/Nitro | `pnpm build` |
| Test active Go worker | `pnpm test:worker` |

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
- The worker must not duplicate or import control-plane business domains.
- Instance operations are limited to `ensure`, `inspect`, `destroy`, and
  `reconcile` until a later approved OpenSpec change expands the protocol.
- Provider operations must be idempotent, use deterministic resource names and
  complete ownership labels, and must not use shell command concatenation.
- Docker uses the Engine API; Kubernetes uses `client-go`.

## Verification and editing

- Use `rg`/`rg --files` for searches and `apply_patch` for edits.
- Preserve unrelated dirty-worktree changes.
- A task checkbox may be completed only after its stated tests pass.
- Before marking monorepo or boundary work complete, run at least:
  `pnpm check:toolchain`, `pnpm check:boundaries`,
  `pnpm check:jeopardy-scope`, `pnpm generate:api`, `pnpm typecheck`,
  `pnpm test:contracts`, `pnpm build`, and `pnpm test:worker`.
