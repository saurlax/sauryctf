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
| Refresh OpenAPI outputs | `pnpm generate:api` |
| Full test suite | `pnpm test` |

## Local Smoke Flow

- End-to-end local validation guide lives in `docs/get-started/smoke-flow.md`.
- OpenAPI generation now has one canonical refresh command:
  - `pnpm generate:api`
  - this regenerates both backend `internal/http/api.gen.go` and frontend `frontend/app/types/api.d.ts`
  - when `api/openapi.yaml` changes, do not update only one side
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
  - by default it now self-starts an isolated backend on `127.0.0.1:18080` with a temporary SQLite file, so local smoke no longer depends on manually clearing the repo's main `sauryctf.db`
  - `GET /api/games/:id/challenges/:challengeId/instance` returns `idle`
  - `POST /api/games/:id/challenges/:challengeId/instance` returns a running lease
  - the instance response now includes explicit lease policy minutes for initial lease / extension / renewal window
  - a freshly started lease is not immediately renewable; local verification now checks the current renewal-window gating
  - the returned launch data no longer contains unresolved `{{team_hash}}`-style placeholders
- `pnpm smoke:local:docker` now provides an opt-in real local Docker verification path:
  - it now also self-starts an isolated backend plus temporary SQLite state, just like `pnpm smoke:local`
  - the script enables `INSTANCE_DOCKER_PROVIDER_ENABLED=true` for that temporary backend automatically
  - it still requires a reachable local Docker daemon; on Windows, `docker version` must be able to show the `Server` section
  - provisions one `nginx:alpine`-backed dynamic challenge with `runtime.expose = [80]`
  - verifies the returned `launch_url` is a reachable local published port
  - also verifies destroy returns the instance state to `idle`
- `/console/admin` now also exposes one-click contest creation entries for fast local setup:
  - creates one public auto-accept game
  - creates one `dynamic` challenge with team-scoped instance defaults
  - mounts it automatically so operators can jump straight into public-page lease verification
- Admin-facing copy has been tightened to stay product-oriented:
  - public pages and admin shortcuts no longer reference external projects in user-facing descriptions
  - quick-create entries use formal contest labels and avoid setup-style wording
- Admin audit logs are now minimally implemented:
  - `/console/admin/audit` lists recent management actions for users, games, and challenges
  - current recorded actions include create/update/delete flows for games and challenges, plus admin user updates and challenge mounting

## Frontend (`frontend/`)

**Tech stack:** Nuxt 4.4 + Vue 3.5 + @nuxt/ui 4.8 + Tailwind CSS 4.3

**Directory structure:**
- `app/pages/index.vue` — Home / landing page
- `app/pages/login.vue` — Minimal login entry
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
- Dialog-like interactions such as create/edit forms, delete confirmations, and destructive secondary actions should be wrapped in `UModal` instead of leaving temporary confirmation blocks in the page body.
- Account security, enrollment confirmation, and similar low-frequency sensitive actions should prefer `UModal` entry flows so the page body stays focused on status and summary information.
- Page-owned `UModal` declarations may be grouped near the end of a Vue template; that is acceptable as long as the visible page body does not duplicate the modal form or confirmation content.
- If a page already has modal-based create/edit flows, do not keep a second full inline version of the same form in the main page body unless there is a clear operational reason.
- User-facing page copy should stay formal and product-oriented; avoid temporary notes, onboarding-style placeholders, and testing slang in visible UI text.
- Public pages, login/register pages, and console home should not carry setup-wizard or initialization-style panels. Empty-state handling should stay minimal and operational.
- The public home page should function as a concise platform entry, not a marketing-style feature showcase; prefer direct access cards and current actions over large capability grids.
- The no-team view at `/console/team` should keep a single primary entry card plus one concise rules/boundary card; avoid stacking multiple alerts and repeated status summaries for the same create/join flow.
- On `/console/team`, invite-context, next-step, and no-team entry notices should prefer compact summary cards with actions instead of full-width `UAlert` blocks when they are mainly restating current state and available navigation.
- Admin-visible page copy should also avoid temporary operator phrasing such as `使用说明` or `快速开始`; prefer formal maintenance labels like `录入约定`, `检查项`, and `概览`.
- The top-right guest navigation keeps two distinct actions, `登录` and `注册`; do not collapse them into a merged auth button.
- Account-related status cards should avoid `当前状态：...`-style headings; prefer direct operational titles.
- Public game pages should prefer state summaries such as `报名状态`, `队伍状态`, and `提交权限`; avoid numbered participation steps or overly tutorial-style action labels.
- In the public game `Writeup` tab, avoid stacking a top summary grid, a side status card, and a separate rules list for the same state. Keep one editor card plus one compact status/review side card.
- In public challenge cards, prefer one compact status summary block plus structured instance/attachment sections. Avoid stacking multiple `UAlert` components for the same card-level state.
- On public game tabs such as `challenges`, `scoreboard`, and `writeup`, prefer one compact status summary header instead of repeating large `UAlert` blocks for visibility, freeze, or submission state.
- On the public game overview sidebar, prefer one context card plus one rules/boundary card instead of splitting participant status, restrictions, and division info across too many small cards.
- At the top of the public game detail page, keep one primary participation status block plus a compact next-step action row. Do not stack multiple large conclusion alerts for the same state.
- On the console home page, prefer one consolidated workbench card for current summary, pending action, and common entry buttons instead of splitting overview and entry into separate cards with overlapping purpose.
- On the public `/games` list page, prefer one compact entry banner and one combined per-card participation/rules summary. Do not split card-level context into multiple stacked status boxes.
- In admin-facing checklist sections, prefer a compact section summary header plus the actual checklist cards. Avoid placing a full-width `UAlert` above a list when it only repeats the section title and purpose.
- On admin entry cards such as `管理入口`, `比赛录入`, `题目维护`, and `维护入口`, prefer one compact summary header instead of stacking a `UAlert` above the actual action row and context cards.
- If a low-frequency action already uses `UModal`, do not simulate a second dialog inside the page body with another elevated explanation block; keep the body to one concise summary sentence plus the real entry action.
- In admin review lists such as participants or writeups, draft values like pending status, division, or review remark should stay as one compact summary row instead of multiple mini-cards.
- On `/console/admin`, page-top sections such as `管理入口`, `当前检查项`, or `发布前检查` should prefer one concise summary line before the real cards, not another elevated header block.
- In admin modals such as challenge create/edit, instance access-mode explanations should use compact summary blocks instead of `UAlert` when they are informational rather than exceptional.
- On `/console/admin`, low-frequency maintenance forms such as contest settings, create/edit flows, import/export confirmations, and similar operator write actions should prefer `UModal`; the page body should focus on overview, lists, monitoring, and current context summaries.
- In `/console/admin` sections such as `比赛挂题`, keep the page body focused on current contest context and mounted-resource lists; challenge selection, score overrides, and similar low-frequency maintenance input should stay inside `UModal`.
- On console and admin list pages, page-top reminders such as password-risk notices or account-permission scope should also prefer one compact summary card instead of a standalone full-width `UAlert`.
- On utility pages such as `/console/account` or `/local-instance/**`, state conclusions like password risk, login requirement, load failure, or current lease status should prefer one compact summary card per area instead of multiple stacked `UAlert` blocks.
- In console pages, prefer neutral internal names such as `context`, `checklist`, and `entry` over `setup` for maintenance-oriented panels and computed state.
- Challenge attachments remain a JSON string array. For local files, prefer the admin upload entry so `/attachments/**` paths stay consistent with import/export behavior.
- If a challenge defines `flag_format`, player-facing pages should reuse it for display and submit placeholders instead of hard-coding `flag{...}`.
- For player-facing challenge content, prefer shared parsing/display helpers for `hints` and `attachments` instead of duplicating JSON parsing in page files.
- Error toast descriptions use `e.data?.message || e.message`.
- API requests go through `/api/**` (dev proxy via `nuxt.config.ts` `devProxy` to `localhost:8080`).
- Preferred local frontend entry is `pnpm dev:frontend`, which binds Nuxt to `127.0.0.1:3000` for a predictable browser login flow.
- For local auth debugging, keep the browser on `127.0.0.1:3000` and let requests stay on same-origin `/api/**` so Nuxt dev proxy can preserve the login cookie flow.
- Frontend local dev now disables remote Google font providers in `nuxt.config.ts`, so `pnpm dev:frontend` does not depend on external font metadata fetches just to boot locally.
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
- Dynamic container management must be idempotent; runtime resources must be uniformly labeled.
- Dynamic scoring is shared across standalone challenge submission and game-scoped submission.
- Current blood metadata (`first`, `second`, `third`) is retained for display, but does not apply an extra score multiplier.
- Only when the `users` table is completely empty, backend startup auto-creates the default administrator account: `admin / sauryctf`.
- Do not add a dedicated initialization, first-run, or account-setup page for this account. The only required behavior is the backend-side empty-database check above.
- The frontend exposes separate `/login` and `/register` entries in the top-right navigation for account access.
- `/login` and `/register` should stay as single-card form pages; do not append secondary summary panels, setup notes, or onboarding-style sidebars.
- On `/login` and `/register`, redirect behavior should be conveyed with one light footer sentence when needed; do not promote it into a top-level `UAlert` or extra guidance card.
- `/console/account` now provides a minimal account-security page:
  - logged-in users can change their own password
  - if the default administrator still uses the initial password, both `/console` and `/console/account` surface a prominent reminder
  - the password-maintenance card itself should stay compact: one action summary, one clear button, and modal-based editing; avoid repeating the same password-risk warning both inside the page card and again in the modal trigger area
  - guest-facing empty-database state and logged-in password-risk state are now split:
    - `/api/auth/setup-status` only reports whether an empty database can still use the default administrator
    - `/api/auth/security-status` reports `password_change_recommended` for the current logged-in session
- `/console/admin/users` now provides a minimal account-management page for `admin` / `super_admin`:
  - lists current users with role and status
  - supports updating one user's role or status inline
  - current user cannot ban self; only `super_admin` can manage `super_admin`
- Direct `/register` success now lands on `/console/team`, so first-time players can create or join a team immediately instead of bouncing through `/console` first.
- If registration started from a public game page, success now lands on `/console/team?redirect=...`, so the game return path stays available through the team flow.
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
  - the admin challenge form now ships a dedicated “team-scoped instance” default and shows the supported placeholder tokens inline, so local operators can create per-team dynamic entry data without hand-writing the whole JSON structure
  - the public game page now distinguishes between placeholder connection info and the resolved per-team lease entry, so players can tell whether an instance URL is still unresolved or already issued to the current team
  - local verification defaults for dynamic challenges now point to a frontend `/local-instance/...` page so the resolved launch URL can be opened directly during local verification
- the public game page now presents managed instances with clearer operator-facing signals: lease countdown, progress bar, local-entry hint, and a lightweight auto-refresh for running leases
- outward-facing product copy now prefers formal platform wording such as "local verification", "local access page", and "base implementation" instead of test-oriented phrasing
- management pages continue to avoid temporary or development-oriented wording in user-facing headings, alerts, and action labels; prefer operational phrasing such as "环境检查", "入口确认", and "基础流程"
- admin-side instance-type recognition should prefer stable `container_spec.metadata` markers over challenge titles, so checklist and helper flows do not break when operators rename a challenge
- the public game page now also summarizes the current lease policy in-place, so players can distinguish "initial lease" from "renewal adds more time" without guessing from backend behavior
- the managed instance API now also returns an explicit `policy` object with initial lease / extension / renewal-window minutes, so frontend panels can render the real current strategy instead of inferring it from messages
  - the same policy now also includes a per-team active-instance limit, so local verification flows already expose a minimal resource cap for managed instances
- managed instances now also support a minimal player-side destroy flow so the current team can reset an active lease without touching the admin side
- managed instance renewal is now gated by a minimal renewal window: the current lease only becomes renewable within 10 minutes before expiry
- when a contest does not enable `writeup_required`, the public game page should keep the Writeup tab informational only and must not imply that players can still submit content there
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
  - `runtime.expose` accepts common Docker publish forms such as `80`, `8080:80`, and `127.0.0.1:8080:80`; instance response port matching now always keys off the container-side port reported by `docker inspect`
  - if `docker inspect` returns a concrete published `HostIp`, instance response now prefers that real bound address over the fallback host setting; IPv6 launch URLs are normalized with `[]`
  - the admin challenge form's generic `容器 Web` entry now defaults to `nginx:alpine` with `expose: [80]`, so local operators have one default that is closer to a truly runnable Docker-backed web challenge
  - current scope is intentionally local-machine oriented: one container per team/challenge lease, no compose, no volumes, no network policy, and no registry auth management yet
- local dynamic instance renewal now uses a clearer `defaultLifetime / extensionDuration / renewalWindow` split instead of reusing the initial lease duration for every renewal
- Registration withdrawal now follows the current platform rule:
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
- Game metadata now follows a more complete contest configuration model:
  - `practice_mode` controls whether the contest should continue exposing a post-contest practice posture in the UI
  - `writeup_required` marks contests that expect a post-contest writeup submission
  - `writeup_deadline` can be left empty, but when set it must not be earlier than `end_time`
  - these fields now round-trip through game create/update, public/admin reads, and contest import/export packages
- Games now support a lightweight `division` model:
  - admins can configure a contest's division list directly on create/update
  - participations can be assigned to one configured division from the admin contest page
  - the public scoreboard can be filtered by division while still supporting an overall view
- A minimal writeup workflow now exists for contests that require it:
  - accepted teams can submit or overwrite their contest writeup from the game detail page
  - writeups are blocked when the contest does not require them or the deadline has passed
  - admins can list submitted writeups per contest and mark them `approved` or `rejected`
- Once player submission, admin review, and export behavior all exist, keep the writeup flow documented as one standalone guide under `docs/guide/` instead of leaving the rules fragmented only across broader page docs.
- Keep `docs/README.md` updated as the main human-facing entrypoint whenever new guide or get-started documents are added; avoid making readers discover important docs only by scanning the folder tree.
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
- For local smoke isolation, backend startup also honors `SQLITE_PATH`; when set, SQLite uses that explicit file instead of the repo-root `sauryctf.db`.
- Set `DATABASE_URL` env var to automatically switch to PostgreSQL.
- GORM AutoMigrate manages schema — see `internal/db/db.go` `Migrate()`.
- `.env` files are auto-loaded (see `internal/config/config.go`); see `.env.example`.
