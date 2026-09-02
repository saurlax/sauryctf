# SauryCTF

SauryCTF is a self-hosted, Jeopardy-first CTF platform organized as a monorepo.

```text
apps/web       Nuxt 4/Nitro public control plane
apps/worker    private Go dynamic-instance worker
```

PostgreSQL stores authoritative facts and cross-replica coordination state.
NuxtHub manages PostgreSQL access and S3-compatible or local Blob storage. Challenge traffic is served
through Gateway/Ingress rather than through the control plane or worker.

## Development

```bash
pnpm install --frozen-lockfile
docker compose -f compose.dev.yml up -d --wait
pnpm db:migrate
pnpm dev
```

常用命令保持在根 `package.json`：

```bash
pnpm dev
pnpm start
pnpm build
pnpm test
pnpm check
pnpm db:migrate
pnpm worker
```

默认 Blob 使用本机 `apps/web/.data/blob`。只有验证共享 S3 时才运行 `docker compose -f compose.dev.yml --profile s3 up -d --wait` 并启用 `.env.example` 中完整的 S3 配置组。

较重的集成与发布验收直接运行 `scripts/` 下的脚本：

```bash
bash ./scripts/test-onboarding.sh
bash ./scripts/test-jeopardy-smoke.sh
bash ./scripts/test-release-acceptance.sh
```

See [docs/README.md](docs/README.md) for onboarding, production deployment,
operations, incident response, backup and architecture guides.
