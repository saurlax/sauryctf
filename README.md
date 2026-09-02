# SauryCTF

SauryCTF is a self-hosted, Jeopardy-first CTF platform organized as a monorepo.

```text
apps/web       Nuxt 4/Nitro public control plane
apps/worker    private Go dynamic-instance worker
```

PostgreSQL stores authoritative facts, Redis stores rebuildable derived state,
and S3-compatible storage stores content objects. Challenge traffic is served
through Gateway/Ingress rather than through the control plane or worker.

## Development

```bash
pnpm install --frozen-lockfile
pnpm dev:dependencies
pnpm db:migrate
pnpm dev:web
```

空环境自动 onboarding 与完整 Jeopardy 冒烟：

```bash
pnpm test:onboarding
pnpm test:smoke
```

Run the repository checks with:

```bash
pnpm check:toolchain
pnpm check:boundaries
pnpm check:jeopardy-scope
pnpm test:contracts
pnpm test:db
pnpm test:capacity
pnpm test:backup-recovery
pnpm test:faults
pnpm test:security
pnpm test:instances:lifecycle
pnpm test:onboarding
pnpm test:smoke
pnpm test:release
pnpm typecheck
pnpm build
pnpm test:worker
```

See [docs/README.md](docs/README.md) for onboarding, production deployment,
operations, incident response, backup and architecture guides.
