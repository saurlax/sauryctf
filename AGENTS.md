# SauryCTF — AI Agent Instructions

A k3s-based CTF/AWD competition platform. Go backend + Nuxt 4 SSG frontend.

## Architecture

- Go backend lives in the repo root; Nuxt frontend lives in `frontend/`.
- Frontend is pure SSG (`nuxt generate`) — no SSR/Nitro for business logic.
- Backend is a monolith: API, auth, database, cron jobs, k3s lifecycle, and challenge proxies all run in one process.
- Frontend must never access Kubernetes directly; all cluster operations go through the backend API.

## Quick Reference

| Action | Command |
|--------|--------|
| Start both (dev) | `pnpm dev` |
| Start backend only | `pnpm dev:backend` |
| Start frontend only | `pnpm dev:frontend` |
| Local smoke flow | `pnpm smoke:local` |
| Local docker smoke flow | `pnpm smoke:local:docker` |
| Backend tests | `pnpm test:backend` (single package: `go test ./internal/auth/... -v -p 1`) |
| Frontend type check | `pnpm typecheck` |
| Frontend build | `pnpm generate` |
| Full test suite | `pnpm test` |

## Local Smoke Flow

- End-to-end local validation guide lives in `docs/get-started/smoke-flow.md`.
- Preferred verification order on a fresh database:
  1. login with `admin / sauryctf`
  2. create one public contest
  3. create one challenge
  4. attach the challenge
  5. activate the contest
  6. register a normal user
  7. create a team
  8. join the contest
  9. submit one known flag
  10. confirm the scoreboard updates
- `pnpm smoke:local` now also provisions one minimal dynamic challenge and verifies:
  - `GET /api/games/:id/challenges/:challengeId/instance` returns `idle`
  - `POST /api/games/:id/challenges/:challengeId/instance` returns a running lease
  - the instance response now includes explicit lease policy minutes for initial lease / extension / renewal window
  - a freshly started lease is not immediately renewable; local smoke now checks the current GZCTF-style renewal-window gating
  - the returned launch data no longer contains unresolved `{{team_hash}}`-style placeholders
- `pnpm smoke:local:docker` now provides an opt-in real local Docker verification path:
  - requires `INSTANCE_DOCKER_PROVIDER_ENABLED=true`
  - provisions one `nginx:alpine`-backed dynamic challenge with `runtime.expose = [80]`
  - verifies the returned `launch_url` is a reachable local published port
  - also verifies destroy returns the instance state to `idle`
- `/console/admin` now also exposes a one-click dynamic smoke provision flow:
  - creates one public auto-accept game
  - creates one `dynamic` challenge with team-scoped instance templates
  - mounts it automatically so operators can jump straight into public-page lease verification

## Frontend (`frontend/`)

**Tech stack:** Nuxt 4.4 + Vue 3.5 + @nuxt/ui 4.8 + Tailwind CSS 4.3

**Directory structure:**
- `app/pages/index.vue` — Home / landing page
- `app/pages/login.vue` — Login entry with bootstrap admin hint
- `app/pages/register.vue` — Public registration entry for new players
- `app/pages/games/index.vue` — Games list
- `app/pages/games/[id].vue` — Game detail + challenges
- `app/pages/console/index.vue` — Console dashboard (protected)
  - shows team summary, recent public contests, a "my contests" section based on `/api/games/{id}/participation`, and admin-only quick game status actions for common smoke flows
- `app/pages/console/admin.vue` — Admin contest workspace
  - includes a selected-game overview and preflight checklist so admins can verify mount, registration, and public-readiness before opening a contest
- `app/pages/console/team.vue` — Team management with captain/member-specific actions
- `app/layouts/default.vue` — Global layout (Header/Footer/Navigation)
- `app/composables/useAuth.ts` — Auth state management with client-side session restore and request deduping
- `app/middleware/auth.ts` — Route guard (protects /console/* routes)
- `app/middleware/admin.ts` — Role guard for `/console/admin`, redirects non-admin users back to `/console`
- `app/plugins/auth-init.client.ts` — Restore current user once on client startup
- `app/assets/css/main.css` — Global styles

**Conventions:**
- **Prefer Nuxt UI components** — avoid hand-writing Tailwind/CSS unless layout requires it.
- Keep UI clean; use component composition.
- Error toast descriptions use `e.data?.message || e.message`.
- API requests go through `/api/**` (dev proxy via `nuxt.config.ts` `devProxy` to `localhost:8080`).
- Preferred local frontend entry is `pnpm dev:frontend`, which binds Nuxt to `127.0.0.1:3000` for a predictable browser login flow.
- For local auth debugging, keep the browser on `127.0.0.1:3000` and let requests stay on same-origin `/api/**` so Nuxt dev proxy can preserve the login cookie flow.
- **After every frontend code change, run `cd frontend && pnpm nuxt typecheck` to ensure type safety.**

## Backend (repo root)

**Tech stack:** Go + Gin + GORM + JWT v5

**Entry point:** `cmd/server/main.go`

**Modules (`internal/`):**

| Module | Responsibility |
|--------|---------------|
| `auth/` | Registration, login, JWT verification, logout |
| `rbac/` | AuthMiddleware (JWT validation) + RequireRole middleware |
| `teams/` | Team create/join/leave/remove member |
| `challenges/` | Challenge CRUD, flag submission, dynamic scoring |
| `games/` | Game CRUD, challenge association |
| `models/` | Data models (User, Session, Team, TeamMember, Challenge, Solve, Game, GameChallenge) |
| `config/` | Env var loading (HOST, PORT, DATABASE_URL, JWT_SECRET, instance lease policy) |
| `db/` | Database connection (SQLite by default; PostgreSQL when DATABASE_URL is set), migration, test helpers (`ConnectTest`, `CleanTables`) |
| `http/` | Gin server init, route registration (`/api/healthz`, plus all CRUD routes below) |

**User roles:** `user`, `team_captain`, `judge`, `admin`, `super_admin`

**Challenge categories:** `web`, `pwn`, `crypto`, `reverse`, `misc`, `forensics`, `awd`

**Challenge types:** `static`, `dynamic` (with decay-based scoring: `base_score`, `min_score`, `decay_rate`)

**API endpoints (summary):**

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/healthz` | — | Health check |
| `POST` | `/api/auth/register` | — | Register |
| `POST` | `/api/auth/login` | — | Login → JWT |
| `POST` | `/api/auth/logout` | ✓ | Invalidate session |
| `GET` | `/api/auth/me` | ✓ | Current user info |
| `POST` | `/api/teams` | ✓ | Create team |
| `POST` | `/api/teams/join` | ✓ | Join by invite code |
| `POST` | `/api/teams/leave` | ✓ | Leave team |
| `GET` | `/api/teams/my` | ✓ | My team info |
| `DELETE` | `/api/teams/:id/members/:mid` | ✓ | Remove member (captain) |
| `POST` | `/api/challenges` | admin | Create challenge |
| `GET` | `/api/challenges` | ✓ | List (query: `category`, `show_hidden`) |
| `GET` | `/api/challenges/:id` | ✓ | Get challenge |
| `PUT` | `/api/challenges/:id` | admin | Update challenge |
| `DELETE` | `/api/challenges/:id` | admin | Delete challenge |
| `POST` | `/api/challenges/:id/submit` | ✓ | Submit flag |
| `POST` | `/api/games` | admin | Create game |
| `GET` | `/api/games` | ✓ | List (query: `all=true`) |
| `GET` | `/api/games/:id` | ✓ | Get game |
| `PUT` | `/api/games/:id` | admin | Update game |
| `DELETE` | `/api/admin/games/:id` | admin | Delete game and its game-scoped relations |
| `POST` | `/api/games/:id/challenges` | admin | Add challenge to game |
| `DELETE` | `/api/games/:id/challenges/:cid` | admin | Remove challenge from game |

**Each business module follows a uniform pattern:**
```
internal/<module>/
├── interface.go    # ServiceInterface definition + request/response structs
├── service.go      # Service implementation (GORM database operations)
├── handler.go      # Handler (HTTP route handling, depends on ServiceInterface)
├── mock_test.go    # MockService (in-memory test implementation)
├── handler_test.go # Handler tests (pure mock, no database dependency)
└── service_test.go # Service tests (SQLite :memory:, no external dependencies)
```

**Conventions:**
- Handlers depend only on `ServiceInterface`, never directly on concrete `*Service`.
- All admin operations write audit logs.
- Dynamic container management must be idempotent; Kubernetes resources must be uniformly labeled.
- Dynamic scoring is shared across standalone challenge submission and game-scoped submission.
- Current blood metadata (`first`, `second`, `third`) is retained for display, but does not apply an extra score multiplier.
- Only when the `users` table is completely empty, backend startup auto-creates a bootstrap admin user: `admin / sauryctf`.
- The frontend now exposes separate `/login` and `/register` entries in the top-right navigation for basic account onboarding.
- Direct `/register` success now lands on `/console/team?onboarding=created`, so first-time players can create or join a team immediately instead of bouncing through `/console` first.
- If registration started from a public game page, success now lands on `/console/team?onboarding=created&redirect=...`, so the first-time onboarding hint and the game return path stay visible at the same time.
- When a guest is redirected from a protected page such as `/console/**`, the target path is preserved in `?redirect=...` so login/register can return the user to the original destination.
- Game registration now follows a lightweight review flow:
  - player join requests create `pending` participations
  - admins can change participant status to `accepted` or `rejected` from the admin contest page
  - only `accepted` teams can submit flags during an active game
- Games can now choose a registration strategy:
  - `review` keeps the lightweight approval flow above
  - `auto_accept` turns join requests directly into accepted participations for faster local events
- Games can now optionally configure `scoreboard_freeze_at`:
  - the public scoreboard freezes after that time
  - submissions after freeze still score normally, but no longer affect the public ranking view
- Game lifecycle rules are now enforced by the backend:
  - only `active` games accept registrations
  - only `active` games within `start_time` / `end_time` accept flag submissions
  - ended games stay browsable, no longer allow registration, and only allow further submissions when `practice_mode` is enabled
  - post-contest practice submissions are stored separately and do not affect the official scoreboard, solve times, or blood statistics
  - if an `active` game has already passed `end_time`, read APIs now surface it as `ended` automatically
- Game challenge content now follows a safer visibility rule:
  - everyone can still see basic challenge metadata such as title, category, score, and solve count
  - full `description`, `hints`, and `attachments` are only exposed after a team is `accepted` and the contest has started
  - admin roles can still inspect full content through a dedicated management query
- Dynamic challenge instances now have a minimal lease lifecycle:
  - when a `dynamic` challenge declares `container_spec.runtime.provider` or `container_spec.runtime.image`, the player page can query and renew an instance lease
  - current endpoints are `GET/POST /api/games/:id/challenges/:challengeId/instance`
  - only `accepted` teams after contest start can use them; post-contest renewals remain available only when `practice_mode` is enabled
  - this is intentionally a database-backed lease skeleton for now, not a real container orchestrator yet
  - the backend now routes lease creation/renewal through a small provider abstraction so future Docker/K8s integrations can replace the skeleton behavior without rewriting the game service
  - the default skeleton provider also supports simple per-team templating in `container_spec.connection.*` using `{{game_id}}`, `{{challenge_id}}`, `{{team_id}}`, `{{user_id}}`, and `{{team_hash}}`, so local dynamic challenges can expose stable team-specific entry data before real providers land
  - the admin challenge form now ships a dedicated “team-scoped instance” template and shows the supported placeholder tokens inline, so local operators can create per-team dynamic entry data without hand-writing the whole JSON structure
  - the public game page now distinguishes between templated connection info and the resolved per-team lease entry, so players see when an instance URL is still a template and when a real team-scoped address has been issued
  - local smoke-oriented dynamic templates now point to a frontend `/mock-instance/...` page so the resolved launch URL can be opened directly during local verification
- the public game page now presents managed instances more like an operator-facing panel: lease countdown, progress bar, mock-vs-real entry hint, and a lightweight auto-refresh for running leases
- the public game page now also summarizes the current lease policy in-place, so players can distinguish "initial lease" from "renewal adds more time" without guessing from backend behavior
- the managed instance API now also returns an explicit `policy` object with initial lease / extension / renewal-window minutes, so frontend panels can render the real current strategy instead of inferring it from messages
  - the same policy now also includes a per-team active-instance limit, so local/mock flows already expose a minimal resource cap closer to GZCTF-style container-count constraints
  - managed instances now also support a minimal player-side destroy flow so the current team can reset an active local/mock lease without touching the admin side
  - managed instance renewal is now gated by a minimal GZCTF-style renewal window: the current lease only becomes renewable within 10 minutes before expiry
- the current local container policy is now env-configurable via:
  - `INSTANCE_LEASE_DURATION_MINUTES` for the initial lease
  - `INSTANCE_EXTENSION_DURATION_MINUTES` for each successful renewal
  - `INSTANCE_RENEWAL_WINDOW_MINUTES` for how close to expiry a team may renew
  - `INSTANCE_TEAM_ACTIVE_LIMIT` for how many dynamic instances one team may keep running at the same time inside a single game
- the monolith now also performs a minimal expired-lease cleanup loop:
  - it scans expired challenge-instance leases on a timer
  - it asks the provider to destroy the expired instance before deleting the local lease row
  - the interval is configurable with `INSTANCE_CLEANUP_INTERVAL_SECONDS`
- a minimal local Docker CLI provider is now available for managed instances:
  - default behavior is still the current skeleton lease flow, even if `runtime.provider = docker`
  - only when `INSTANCE_DOCKER_PROVIDER_ENABLED=true` is set will the backend replace the `"docker"` provider with a real local CLI-backed provider
  - the current implementation uses deterministic container names plus `docker run -d`, `docker inspect`, and `docker rm -f`
  - `INSTANCE_DOCKER_HOST` controls the host returned to players in `launch_url` / `host`
  - `runtime.expose` is now parsed from `container_spec.runtime.expose` and is used to publish container ports when the real Docker provider is enabled
  - the admin challenge form's generic `动态容器` template now defaults to `nginx:alpine` with `expose: [80]`, so local operators have one template that is closer to a truly runnable Docker-backed web challenge
  - current scope is intentionally local-machine oriented: one container per team/challenge lease, no compose, no volumes, no network policy, and no registry auth management yet
- local dynamic instance renewal now behaves closer to GZCTF's `defaultLifetime / extensionDuration / renewalWindow` split, instead of reusing the initial lease duration for every renewal
- Registration withdrawal now follows the current GZCTF-style rule:
  - `pending` / `rejected` participations can be withdrawn
  - `accepted` participations are locked and can no longer be withdrawn
  - while a team is `accepted` in any not-yet-ended game, team membership is also locked:
    - no new members can join that team
    - existing members cannot leave
    - captains cannot remove members
- Game configuration now validates key contest times:
  - `end_time` must be later than `start_time`
  - `scoreboard_freeze_at` must stay within the contest window when configured
- Public contest visibility is now tighter:
  - public game lists hide `draft` contests
  - direct public detail lookup also hides private or draft contests
  - admins can still inspect them through the `all=true` management path
- Admins can now delete a contest directly from the management page:
  - this removes the game itself plus its participations, solves, and mounted challenge relations
  - original challenge records stay in the challenge library for reuse
- Admins can now export a contest package from the management page:
  - endpoint: `POST /api/admin/games/:id/export`
  - response: ZIP download containing `game.json`
  - current export scope:
    - game metadata
    - mounted challenges with full statement, hints, attachments, flag, scoring, visibility, and score override
  - current export package version is `sauryctf.export.v2`
  - external attachment URLs stay in JSON as-is
  - local attachments under `/attachments/**` are now also embedded into the ZIP for migration
- Admins can now import a previously exported contest package:
  - endpoint: `POST /api/admin/games/import`
  - request: multipart form with a `file` field containing a ZIP export
  - current import scope:
    - accepts both `sauryctf.export.v1` and `sauryctf.export.v2`
    - requires `game.json` inside the ZIP
    - creates a brand new game in `draft` status
    - recreates imported challenges as new records owned by the current admin
    - restores mounted challenge `score_override`
    - restores embedded local attachments from `v2` packages into `./attachments`
  - external attachment URLs still stay as URL arrays and are not downloaded during import
- Game metadata is now closer to GZCTF's contest configuration model:
  - `practice_mode` controls whether the contest should continue exposing a post-contest practice posture in the UI
  - `writeup_required` marks contests that expect a post-contest writeup submission
  - `writeup_deadline` can be left empty, but when set it must not be earlier than `end_time`
  - these fields now round-trip through game create/update, public/admin reads, and contest import/export packages
- Games now support a lightweight `division` model closer to GZCTF:
  - admins can configure a contest's division list directly on create/update
  - participations can be assigned to one configured division from the admin contest page
  - the public scoreboard can be filtered by division while still supporting an overall view
- A minimal writeup workflow now exists for contests that require it:
  - accepted teams can submit or overwrite their contest writeup from the game detail page
  - writeups are blocked when the contest does not require them or the deadline has passed
  - admins can list submitted writeups per contest and mark them `approved` or `rejected`
- Challenge content delivery is now expected to use:
  - `description` for the main statement
  - `hints` as a JSON string array
  - `attachments` as a JSON string array of downloadable URLs

## Makefile (legacy — prefer pnpm scripts above)

| Target | Command |
|--------|---------|
| `make test` | Run full test suite |
| `make test-backend` | `go test ./...` |
| `make test-frontend` | `cd frontend && pnpm test` |
| `make dev-backend` | `go run ./cmd/server` |
| `make dev-frontend` | `cd frontend && pnpm dev` |
| `make generate` | `cd frontend && pnpm generate` |

## Testing

**Backend testing strategy (strict layering):**
- **Handler/Middleware tests**: Use MockService — pure in-memory, no database dependency. Validate HTTP request/response.
- **Service tests**: Use `db.ConnectTest()` to create a SQLite `:memory:` database. Call `db.CleanTables()` before/after each test to reset state.
- Run tests with `-p 1` for serial execution (SQLite in-memory does not support concurrent writes).

**Frontend testing:**
- Type check: `cd frontend && pnpm nuxt typecheck`
- Build verification: `cd frontend && pnpm generate`

## Workflow

- Check Context7 docs before implementing to confirm latest library usage.
- Follow TDD: write/update tests first, then implement.
- Install dependencies using package manager commands:
  - Frontend: `pnpm add <pkg>@latest` or `pnpm add -D <pkg>@latest`
  - Backend: `go get <module>@latest && go mod tidy`
- Small commits, Conventional Commit format: `feat(auth): add login endpoint`, `test(score): cover dynamic scoring`

## Database

- SQLite is the default for local development (`sauryctf.db`) — zero configuration.
- Set `DATABASE_URL` env var to automatically switch to PostgreSQL.
- GORM AutoMigrate manages schema — see `internal/db/db.go` `Migrate()`.
- `.env` files are auto-loaded (see `internal/config/config.go`); see `.env.example`.
