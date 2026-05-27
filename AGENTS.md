This project is being planned as a CTF/AWD platform with a Go backend at the repository root and a Nuxt 4 SSG frontend in a subdirectory.

## Architecture

- The repository root is the Go backend/application root. Do not create a separate `backend/` directory for the Go service.
- The Nuxt frontend should live under `frontend/`.
- The frontend is SSG-only. Use `nuxt generate` for static output; do not design or rely on Nuxt SSR/Nitro server APIs for product backend logic.
- The Go backend is a monolithic application: it owns API, auth, database access, background jobs, k3s lifecycle control, reconcile logic, and future challenge proxy services in one deployable service unless explicitly changed later.

- The frontend must never access Kubernetes directly; all cluster operations go through the Go backend/controller.

## Research and implementation workflow

- Before each implementation step, read the relevant spec first. If `specs/` contains local planning drafts, use them as context but treat `AGENTS.md` as the hard rule source.
- Before each implementation step, check Context7 and relevant official/network documentation for the libraries being used.
- Prefer TDD: write or update tests before implementing behavior.

- Install dependencies with package manager commands instead of manually editing dependency files:
  - Frontend: `pnpm add <pkg>@latest` or `pnpm add -D <pkg>@latest`.
  - Backend: `go get <module>@latest` followed by `go mod tidy`.
- Work in small, reviewable steps. When commits are explicitly requested, commit step-by-step with Conventional Commit messages, for example `feat(auth): add login endpoint` or `test(score): cover dynamic scoring`.

## Frontend

- Use Nuxt 4 SSG in `frontend/`.
- Prioritize Nuxt UI components and avoid custom Tailwind/CSS unless necessary for layout.
- Keep the UI clean and component-composed.
- For error toasts, include `e.data?.message || e.message` in the description when applicable.

## Backend

- Use one monolithic Go backend at the repository root.
- Prefer one main application entrypoint, such as `cmd/sauryctf` or `cmd/server`; do not split API, worker, controller, and proxy into many binaries unless the user explicitly decides to change the architecture later.

- Put business modules under `internal/`, for example `internal/http`, `internal/instances`, `internal/k8s`, `internal/proxy`, `internal/scoreboard`, and `internal/auth`.
- The challenge proxy is a long-running backend service that forwards Kubernetes challenge traffic through HTTP/WebSocket/TCP tunnels. It is not a manual CLI management command.
- Kubernetes lifecycle, TTL cleanup, and reconcile logic should live in internal services/controllers and run as part of the backend process initially; they can be split into separate processes only when scaling or HA requires it.
- Prefer simple, explicit backend APIs and keep business logic testable.
- Dynamic container management must be idempotent and label all Kubernetes resources consistently.
- All admin operations should write audit logs.
