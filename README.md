# SauryCTF

SauryCTF is a self-hosted, Jeopardy-first CTF platform currently being rebuilt
as a monorepo.

```text
apps/web       Nuxt 4/Nitro public control plane
apps/worker    private Go dynamic-instance worker
legacy/        isolated migration reference, not production architecture
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
pnpm typecheck
pnpm build
pnpm test:worker
```

See [docs/README.md](docs/README.md) for architecture and development guides.
