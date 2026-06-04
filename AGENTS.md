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
| Backend tests | `pnpm test:backend` (single package: `go test ./internal/auth/... -v -p 1`) |
| Frontend type check | `pnpm typecheck` |
| Frontend build | `pnpm generate` |
| Full test suite | `pnpm test` |

## Frontend (`frontend/`)

**Tech stack:** Nuxt 4.4 + Vue 3.5 + @nuxt/ui 4.8 + Tailwind CSS 4.3

**Directory structure:**
- `app/pages/index.vue` — Home / landing page
- `app/pages/login.vue` — Unified login entry with bootstrap admin hint
- `app/pages/games/index.vue` — Games list
- `app/pages/games/[id].vue` — Game detail + challenges
- `app/pages/console/index.vue` — Console dashboard (protected)
- `app/pages/console/team.vue` — Team management with captain/member-specific actions
- `app/layouts/default.vue` — Global layout (Header/Footer/Navigation)
- `app/composables/useAuth.ts` — Auth state management with client-side session restore and request deduping
- `app/middleware/auth.ts` — Route guard (protects /console/* routes)
- `app/plugins/auth-init.client.ts` — Restore current user once on client startup
- `app/assets/css/main.css` — Global styles

**Conventions:**
- **Prefer Nuxt UI components** — avoid hand-writing Tailwind/CSS unless layout requires it.
- Keep UI clean; use component composition.
- Error toast descriptions use `e.data?.message || e.message`.
- API requests go through `/api/**` (dev proxy via `nuxt.config.ts` `devProxy` to `localhost:8080`).
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
| `config/` | Env var loading (HOST, PORT, DATABASE_URL, JWT_SECRET) |
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
- On a fresh database, backend startup auto-creates a bootstrap admin user: `admin / sauryctf`.

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
